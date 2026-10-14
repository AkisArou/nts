Pod::Spec.new do |s|
  s.name         = 'Hum'
  s.version      = '0.1.0'
  s.summary      = 'A Swift pod for examples/interop/macos-pods.'
  s.homepage     = 'https://example.invalid/hum'
  s.license      = { :type => 'MIT', :text => 'MIT' }
  s.author       = 'nts'
  s.source       = { :git => 'https://example.invalid/hum.git', :tag => s.version.to_s }
  s.osx.deployment_target = '13.0'
  s.swift_version = '5.0'
  s.source_files = 'Sources/**/*.swift'
end
