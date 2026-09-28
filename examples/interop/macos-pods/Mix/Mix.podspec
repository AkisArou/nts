Pod::Spec.new do |s|
  s.name         = 'Mix'
  s.version      = '0.1.0'
  s.summary      = 'A pod of Objective-C and Swift for examples/interop/macos-pods.'
  s.homepage     = 'https://example.invalid/mix'
  s.license      = { :type => 'MIT', :text => 'MIT' }
  s.author       = 'nts'
  s.source       = { :git => 'https://example.invalid/mix.git', :tag => s.version.to_s }
  s.osx.deployment_target = '13.0'
  s.swift_version = '5.0'
  s.source_files = 'Classes/**/*.{h,m,swift}'
  s.public_header_files = 'Classes/**/*.h'
end
