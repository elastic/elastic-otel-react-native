const ts = require('typescript');

module.exports = {
  process(source, path) {
    return {
      code: ts.transpileModule(source, {
        compilerOptions: {
          esModuleInterop: true,
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
        },
        fileName: path,
      }).outputText,
    };
  },
};
