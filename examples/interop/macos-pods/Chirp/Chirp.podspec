Pod::Spec.new do |s|
  s.name         = 'Chirp'
  s.version      = '0.1.0'
  s.summary      = 'A pod for examples/interop/macos-pods.'
  s.homepage     = 'https://example.invalid/chirp'
  s.license      = { :type => 'MIT', :text => 'MIT' }
  s.author       = 'nts'
  s.source       = { :git => 'https://example.invalid/chirp.git', :tag => s.version.to_s }
  s.osx.deployment_target = '13.0'
  s.source_files = 'Classes/**/*.{h,m}'
  s.public_header_files = 'Classes/Chirp.h'
  s.framework    = 'Foundation'
end
