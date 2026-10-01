import { readFileSync } from 'node:fs';

const packageList = readFileSync(
  'build/external-fixture/android/app/build/generated/autolinking/src/main/java/com/facebook/react/PackageList.java',
  'utf8',
);

if (
  !packageList.includes('ElasticOtelReactNativePackage') ||
  !packageList.includes(
    'new co.elastic.otel.reactnative.ElasticOtelReactNativePackage()',
  )
) {
  throw new Error(
    'The external fixture did not autolink ElasticOtelReactNativePackage.',
  );
}

const podfileLock = readFileSync(
  'build/external-fixture/ios/Podfile.lock',
  'utf8',
);
if (!podfileLock.includes('ElasticOtelReactNative (0.0.0)')) {
  throw new Error(
    'The external fixture did not autolink the ElasticOtelReactNative pod.',
  );
}

const podsProject = readFileSync(
  'build/external-fixture/ios/Pods/Pods.xcodeproj/project.pbxproj',
  'utf8',
);
if (
  !podsProject.includes('https://github.com/elastic/apm-agent-ios.git') ||
  !podsProject.includes('productName = ElasticApm;') ||
  !podsProject.includes('kind = exactVersion;') ||
  !podsProject.includes('version = 1.4.0;')
) {
  throw new Error(
    'The external fixture did not attach the remote ElasticApm Swift package product.',
  );
}
