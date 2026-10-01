module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android/library',
        packageImportPath:
          'import co.elastic.otel.reactnative.ElasticOtelReactNativePackage;',
        packageInstance: 'new ElasticOtelReactNativePackage()',
      },
      ios: {},
    },
  },
};
