package com.kant.messenger;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Hands decrypted attachments and vetted links to other apps.
 *
 * Kant keeps files encrypted at rest, so "Open with…" is the one place
 * plaintext touches disk: the web layer writes it to cache/kant-open/<random>/
 * and asks this plugin to show the system chooser for it. Only files under that
 * directory can be shared, only through a FileProvider content:// URI with a
 * read-only grant, and the directory is swept at cold start, on every resume
 * (anything older than a few minutes) and on "Delete everything".
 *
 * The JS side (src/lib/fileActions.ts) documents the contract an iOS plugin of
 * the same name must implement.
 */
@CapacitorPlugin(name = "KantFiles")
public class KantFilesPlugin extends Plugin {

    /** Must match TEMP_DIR in src/lib/fileActions.ts and the kant_open FileProvider path. */
    static final String TEMP_DIR = "kant-open";

    /** Long enough for the other app to read the file, short enough not to linger. */
    private static final long RESUME_SWEEP_AGE_MS = 10 * 60 * 1000L;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        // A crash or force-stop can skip every other cleanup path; a cold start
        // never has a legitimate reason to keep old copies.
        sweepAsync(0);
    }

    @Override
    protected void handleOnResume() {
        sweepAsync(RESUME_SWEEP_AGE_MS);
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String path = call.getString("path");
        String mimeType = sanitizeMime(call.getString("mimeType"));
        String title = call.getString("title", "Open with");
        if (path == null || path.isEmpty()) {
            call.reject("path is required", "INVALID_PATH");
            return;
        }

        File file;
        try {
            File root = tempRoot().getCanonicalFile();
            file = new File(getContext().getCacheDir(), path).getCanonicalFile();
            // Canonical paths defeat "../" and symlink tricks: only files that
            // really live inside cache/kant-open may be exposed.
            if (!file.getPath().startsWith(root.getPath() + File.separator) || !file.isFile()) {
                call.reject("File is not in the shareable cache", "INVALID_PATH");
                return;
            }
        } catch (IOException e) {
            call.reject("Could not resolve the file", "INVALID_PATH", e);
            return;
        }

        Uri uri;
        try {
            uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (IllegalArgumentException e) {
            call.reject("File is not covered by the FileProvider", "INVALID_PATH", e);
            return;
        }

        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(uri, mimeType);
        // ClipData carries the read grant through the chooser to the chosen app.
        view.setClipData(ClipData.newRawUri(file.getName(), uri));
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        PackageManager pm = getContext().getPackageManager();
        if (view.resolveActivity(pm) == null) {
            call.reject("No app can open this file", "NO_APP");
            return;
        }

        Intent chooser = Intent.createChooser(view, title);
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app can open this file", "NO_APP", e);
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        Uri uri = url == null ? null : Uri.parse(url.trim());
        String scheme = uri == null || uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        // Defence in depth: the web layer already allows only these.
        if (!scheme.equals("https") && !scheme.equals("http") && !scheme.equals("mailto")) {
            call.reject("Only web and mail links can be opened", "UNSAFE_URL");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app can open this link", "NO_APP", e);
        }
    }

    @PluginMethod
    public void clearTemp(PluginCall call) {
        Long olderThanMs = call.getLong("olderThanMs", 0L);
        long age = olderThanMs == null ? 0L : Math.max(0L, olderThanMs);
        io.execute(() -> {
            sweep(age);
            call.resolve();
        });
    }

    private File tempRoot() {
        return new File(getContext().getCacheDir(), TEMP_DIR);
    }

    private void sweepAsync(long olderThanMs) {
        io.execute(() -> sweep(olderThanMs));
    }

    /** Delete entries under cache/kant-open last modified more than `olderThanMs` ago (0 = all). */
    private void sweep(long olderThanMs) {
        File[] entries = tempRoot().listFiles();
        if (entries == null) return;
        long cutoff = System.currentTimeMillis() - olderThanMs;
        for (File entry : entries) {
            if (olderThanMs == 0 || entry.lastModified() < cutoff) deleteRecursively(entry);
        }
    }

    private static void deleteRecursively(File file) {
        File[] children = file.isDirectory() ? file.listFiles() : null;
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private static String sanitizeMime(String mime) {
        if (mime == null) return "application/octet-stream";
        String bare = mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return bare.matches("[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}")
                ? bare
                : "application/octet-stream";
    }
}
