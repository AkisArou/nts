Pod::Spec.new do |s|
  s.name         = 'Beep'
  s.version      = '0.1.0'
  s.summary      = 'A binary framework for examples/interop/macos-pods.'
  s.homepage     = 'https://example.invalid/beep'
  s.license      = { :type => 'MIT', :text => 'MIT' }
  s.author       = 'nts'
  s.source       = { :git => 'https://example.invalid/beep.git', :tag => s.version.to_s }
  s.osx.deployment_target = '13.0'
  # Built by examples/interop/macos-pods/Beep/make.sh; only the binary ships.
  s.vendored_frameworks = 'Beep.xcframework'
end
