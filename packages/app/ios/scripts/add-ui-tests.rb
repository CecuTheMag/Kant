# Adds the AppUITests target and a "KantUITests" scheme to the Xcode project.
#
# Capacitor regenerates parts of ios/ on `cap sync`, so the test target is
# created right before the tests run (CI: .github/workflows/apple.yml) instead
# of being committed. Uses the xcodeproj gem, which ships with CocoaPods.
#
#   ruby packages/app/ios/scripts/add-ui-tests.rb
require 'xcodeproj'

project_path = File.expand_path('../App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'App' } or abort 'App target not found'

if project.targets.any? { |t| t.name == 'AppUITests' }
  puts 'AppUITests already present'
  exit 0
end

target = project.new_target(:ui_test_bundle, 'AppUITests', :ios, '15.0')
group = project.main_group.new_group('AppUITests', 'AppUITests')
Dir[File.join(__dir__, '../App/AppUITests/*.swift')].sort.each do |path|
  target.add_file_references([group.new_reference(File.basename(path))])
end
target.add_dependency(app)
target.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['TEST_TARGET_NAME'] = 'App'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.kant.messenger.uitests'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(target)
scheme.set_launch_target(app)
scheme.save_as(project_path, 'KantUITests', true)
puts 'Added AppUITests target and KantUITests scheme'
