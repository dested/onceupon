Pod::Spec.new do |s|
  s.name           = 'AppleAttribution'
  s.version        = '1.0.0'
  s.summary        = 'Apple AdServices attribution token for the native shell'
  s.description    = 'Exposes AAAttribution.attributionToken() to the WebView bridge.'
  s.author         = 'QuickGame'
  s.homepage       = 'https://onceupon.dested.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
