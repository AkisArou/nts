Pod::Spec.new do |s|
  s.name         = 'Echo'
  s.version      = '0.1.0'
  s.summary      = 'A Swift pod over an Objective-C one, for examples/interop/macos-pods.'
  s.homepage     = 'https://example.invalid/echo'
  s.license      = { :type => 'MIT', :text => 'MIT' }
  s.author       = 'nts'
  s.source       = { :git => 'https://example.invalid/echo.git', :tag => s.version.to_s }
  s.osx.deployment_target = '13.0'
  s.swift_version = '5.0'
  s.source_files = 'Sources/**/*.swift'
  s.dependency 'Chirp'
end
