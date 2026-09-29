Pod::Spec.new do |s|
  s.name           = 'OnDeviceEars'
  s.version        = '1.0.0'
  s.summary        = 'On-device speech recognition (SpeechAnalyzer) for the native shell'
  s.description    = 'Streams SpeechTranscriber results and records the span for the WebView bridge.'
  s.author         = 'QuickGame'
  s.homepage       = 'https://onceupon.dested.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech', 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
