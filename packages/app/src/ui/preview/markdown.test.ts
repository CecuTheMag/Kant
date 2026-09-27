import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inlineText, parseInline, parseMarkdown } from './markdown';
import type { Block, Inline } from './markdown';

const t = (v: string): Inline => ({ t: 'text', v });
const para = (...c: Inline[]): Block => ({ t: 'para', c });

describe('inline', () => {
  test('emphasis, strong, both, strikethrough, code', () => {
    assert.deepEqual(parseInline('a *b* c'), [t('a '), { t: 'em', c: [t('b')] }, t(' c')]);
    assert.deepEqual(parseInline('**b**'), [{ t: 'strong', c: [t('b')] }]);
    assert.deepEqual(parseInline('__b__'), [{ t: 'strong', c: [t('b')] }]);
    assert.deepEqual(parseInline('***b***'), [{ t: 'strong', c: [{ t: 'em', c: [t('b')] }] }]);
    assert.deepEqual(parseInline('~~gone~~'), [{ t: 'del', c: [t('gone')] }]);
    assert.deepEqual(parseInline('`a *b*`'), [{ t: 'code', v: 'a *b*' }]);
    assert.deepEqual(parseInline('``a ` b``'), [{ t: 'code', v: 'a ` b' }]);
  });

  test('nesting', () => {
    assert.deepEqual(parseInline('**a *b* c**'), [{ t: 'strong', c: [t('a '), { t: 'em', c: [t('b')] }, t(' c')] }]);
    assert.deepEqual(parseInline('*a **b** c*'), [{ t: 'em', c: [t('a '), { t: 'strong', c: [t('b')] }, t(' c')] }]);
  });

  test('intraword underscores and lone delimiters stay literal', () => {
    assert.deepEqual(parseInline('snake_case_name'), [t('snake_case_name')]);
    assert.deepEqual(parseInline('2 * 3 * 4'), [t('2 * 3 * 4')]);
    assert.deepEqual(parseInline('**unclosed'), [t('**unclosed')]);
    assert.deepEqual(parseInline('a ~ b ~ c'), [t('a ~ b ~ c')]);
    assert.deepEqual(parseInline('`unclosed'), [t('`unclosed')]);
  });

  test('escapes and entities', () => {
    assert.equal(inlineText(parseInline('\\*not em\\*')), '*not em*');
    assert.equal(inlineText(parseInline('a &amp; b &lt;c&gt; &#65;&#x42; &bogus;')), 'a & b <c> AB &bogus;');
    assert.equal(inlineText(parseInline('\\&amp;')), '&amp;');
    assert.equal(inlineText(parseInline('&#0; &#xD800;')), '\uFFFD \uFFFD');
  });

  test('raw HTML is literal text', () => {
    assert.deepEqual(parseInline('<script>alert(1)</script>'), [t('<script>alert(1)</script>')]);
    assert.deepEqual(parseInline('<img src=x onerror=alert(1)>'), [t('<img src=x onerror=alert(1)>')]);
  });

  test('safe links are kept, unsafe links keep only their label', () => {
    assert.deepEqual(parseInline('[Kant](https://kant.network)'), [{ t: 'link', href: 'https://kant.network', c: [t('Kant')] }]);
    assert.deepEqual(parseInline('[x](https://a.b/c_(d) "title")'), [{ t: 'link', href: 'https://a.b/c_(d)', c: [t('x')] }]);
    assert.deepEqual(parseInline('[x](<https://a.b/sp ace>)'), [{ t: 'link', href: 'https://a.b/sp ace', c: [t('x')] }]);
    assert.deepEqual(parseInline('[click](javascript:alert(1))'), [t('click')]);
    assert.deepEqual(parseInline('[click](data:text/html,x)'), [t('click')]);
    assert.deepEqual(parseInline('[a [nested] label](https://x.io)'), [{ t: 'link', href: 'https://x.io', c: [t('a [nested] label')] }]);
    // A space breaks the link syntax; the URL is still autolinked on its own.
    assert.deepEqual(parseInline('[not a link] (https://x.io)'), [t('[not a link] ('), { t: 'link', href: 'https://x.io', c: [t('https://x.io')] }, t(')')]);
  });

  test('links do not nest', () => {
    const [link] = parseInline('[see [inner](https://b.io)](https://a.io)');
    assert.equal(link.t, 'link');
    assert.equal((link as { href: string }).href, 'https://a.io');
    assert.equal(inlineText([link]), 'see [inner](https://b.io)');
  });

  test('autolinks and bare URLs', () => {
    assert.deepEqual(parseInline('<https://x.io/a>'), [{ t: 'link', href: 'https://x.io/a', c: [t('https://x.io/a')] }]);
    assert.deepEqual(parseInline('go to https://x.io/a.'), [t('go to '), { t: 'link', href: 'https://x.io/a', c: [t('https://x.io/a')] }, t('.')]);
    assert.deepEqual(parseInline('(see https://x.io/wiki/A_(b))'), [t('(see '), { t: 'link', href: 'https://x.io/wiki/A_(b)', c: [t('https://x.io/wiki/A_(b)')] }, t(')')]);
    assert.deepEqual(parseInline('xhttps://x.io'), [t('xhttps://x.io')]);
    assert.deepEqual(parseInline('<javascript:alert(1)>'), [t('<javascript:alert(1)>')]);
  });

  test('images are never loaded — src kept only when it is a safe link', () => {
    assert.deepEqual(parseInline('![logo](https://track.er/p.gif)'), [{ t: 'image', src: 'https://track.er/p.gif', alt: 'logo' }]);
    assert.deepEqual(parseInline('![x](data:image/png;base64,AAAA)'), [{ t: 'image', src: '', alt: 'x' }]);
  });

  test('line breaks', () => {
    assert.deepEqual(parseInline('a  \nb'), [t('a'), { t: 'br' }, t('b')]);
    assert.deepEqual(parseInline('a\\\nb'), [t('a'), { t: 'br' }, t('b')]);
    assert.deepEqual(parseInline('a\nb'), [t('a\nb')]);
    assert.deepEqual(parseInline('a\nb', { breaks: true }), [t('a'), { t: 'br' }, t('b')]);
  });
});

describe('blocks', () => {
  test('headings (ATX and setext) and paragraphs', () => {
    assert.deepEqual(parseMarkdown('# Title #\n\nText\nmore\n\nSub\n---\n\nH1\n==='), [
      { t: 'heading', level: 1, c: [t('Title')] },
      para(t('Text\nmore')),
      { t: 'heading', level: 2, c: [t('Sub')] },
      { t: 'heading', level: 1, c: [t('H1')] },
    ]);
    assert.deepEqual(parseMarkdown('#hashtag'), [para(t('#hashtag'))]);
    assert.deepEqual(parseMarkdown('###### six'), [{ t: 'heading', level: 6, c: [t('six')] }]);
    assert.deepEqual(parseMarkdown('####### seven'), [para(t('####### seven'))]);
  });

  test('fenced and indented code keep content verbatim', () => {
    assert.deepEqual(parseMarkdown('```ts\nconst a = *b*;\n\n<b>x</b>\n```'), [{ t: 'code', lang: 'ts', v: 'const a = *b*;\n\n<b>x</b>' }]);
    assert.deepEqual(parseMarkdown('~~~\nnever closed'), [{ t: 'code', lang: '', v: 'never closed' }]);
    assert.deepEqual(parseMarkdown('    indented\n    code\n\nafter'), [{ t: 'code', lang: '', v: 'indented\ncode' }, para(t('after'))]);
    assert.deepEqual(parseMarkdown('para\n    not code'), [para(t('para\nnot code'))]);
  });

  test('thematic breaks and blockquotes', () => {
    assert.deepEqual(parseMarkdown('a\n\n***\n\n- - -'), [para(t('a')), { t: 'hr' }, { t: 'hr' }]);
    assert.deepEqual(parseMarkdown('> quoted\nlazy\n> > nested'), [
      { t: 'quote', c: [para(t('quoted\nlazy')), { t: 'quote', c: [para(t('nested'))] }] },
    ]);
  });

  test('lists: bullets, ordered start, nesting, tasks', () => {
    const blocks = parseMarkdown('- one\n- two\n  - inner\n- [x] done\n- [ ] todo\n\n3. three\n4. four');
    assert.equal(blocks.length, 2);
    const [ul, ol] = blocks as Extract<Block, { t: 'list' }>[];
    assert.equal(ul.ordered, false);
    assert.equal(ul.items.length, 4);
    assert.deepEqual(ul.items[0].c, [para(t('one'))]);
    assert.equal(ul.items[1].c[1].t, 'list');
    assert.deepEqual(ul.items[2], { task: true, checked: true, c: [para(t('done'))] });
    assert.deepEqual(ul.items[3], { task: true, checked: false, c: [para(t('todo'))] });
    assert.equal(ol.ordered, true);
    assert.equal(ol.start, 3);
    assert.equal(ol.items.length, 2);
  });

  test('a year followed by a dot does not start a list mid-paragraph', () => {
    assert.deepEqual(parseMarkdown('Founded in\n2019. We grew.'), [para(t('Founded in\n2019. We grew.'))]);
  });

  test('changing bullet character starts a new list', () => {
    const blocks = parseMarkdown('- a\n* b');
    assert.equal(blocks.length, 2);
  });

  test('pipe tables with alignment, escaped pipes and code spans', () => {
    const md = '| Name | Amount | Note |\n|:-----|-------:|:----:|\n| Ivan | 12 | a \\| b |\n| `x|y` | 3 |\n\nafter';
    const [table, after] = parseMarkdown(md);
    assert.equal(table.t, 'table');
    const tb = table as Extract<Block, { t: 'table' }>;
    assert.deepEqual(tb.align, ['left', 'right', 'center']);
    assert.deepEqual(tb.head.map(inlineText), ['Name', 'Amount', 'Note']);
    assert.deepEqual(tb.rows[0].map(inlineText), ['Ivan', '12', 'a | b']);
    assert.deepEqual(tb.rows[1].map(inlineText), ['x|y', '3', '']);
    assert.deepEqual(after, para(t('after')));
  });

  test('a pipe line without a delimiter row is just text', () => {
    assert.deepEqual(parseMarkdown('a | b'), [para(t('a | b'))]);
    assert.deepEqual(parseMarkdown('| a | b |\n|---|'), [para(t('| a | b |\n|---|'))]);
  });

  test('tabs, CRLF and NUL are tolerated', () => {
    assert.deepEqual(parseMarkdown('-\tone\r\n-\ttwo').length, 1);
    assert.deepEqual(parseMarkdown('a\u0000b'), [para(t('a\uFFFDb'))]);
  });
});

describe('robustness', () => {
  const time = (fn: () => void) => { const s = performance.now(); fn(); return performance.now() - s; };

  test('deep nesting is bounded', () => {
    assert.doesNotThrow(() => parseMarkdown('>'.repeat(5000) + ' x'));
    assert.doesNotThrow(() => parseMarkdown(Array.from({ length: 500 }, (_, i) => `${'  '.repeat(i)}- x`).join('\n')));
    assert.doesNotThrow(() => parseInline('*'.repeat(10000) + 'x' + '*'.repeat(10000)));
    assert.doesNotThrow(() => parseInline('**a '.repeat(3000)));
  });

  test('pathological input stays fast', () => {
    const cases = [
      '['.repeat(100_000),
      '[a]('.repeat(30_000),
      '*a '.repeat(50_000),
      '_a '.repeat(50_000),
      '`'.repeat(1) + ' ``'.repeat(30_000),
      Array.from({ length: 2000 }, (_, i) => '`'.repeat(i % 50 + 1)).join(' '),
      '~~a '.repeat(50_000),
      '<'.repeat(100_000),
      'http://'.repeat(30_000),
      '| a '.repeat(20_000) + '\n' + '|---'.repeat(20_000),
      '- '.repeat(50_000),
      '> '.repeat(50_000),
    ];
    for (const src of cases) {
      const ms = time(() => parseMarkdown(src));
      assert.ok(ms < 1500, `${JSON.stringify(src.slice(0, 12))}… took ${ms.toFixed(0)}ms`);
    }
  });
});
