Pod::Spec.new do |s|
  s.name           = 'WhistleEars'
  s.version        = '1.0.0'
  s.summary        = 'On-device speech recognition (Cactus Whistle) for the native shell'
  s.description    = 'Runs the Whistle speech model on the needle engine over a rolling mic window and records the span for the WebView bridge.'
  s.author         = 'QuickGame'
  s.homepage       = 'https://onceupon.dested.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'
  # libneedle.a is C++ (cactus-compute/needle, engine 3.1.0; device + simulator slices).
  s.libraries = 'c++'
  s.vendored_frameworks = 'Needle.xcframework'
  s.resource_bundles = { 'WhistleEars' => ['whistle.cact'] }

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # needle.h is a public header of this pod, so the Swift below sees the C API through the umbrella.
  s.source_files = '*.{h,m,mm,swift}'
end
