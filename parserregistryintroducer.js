function parserRegistryIntroducer(execlib){
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    execSuite = execlib.execSuite,
    parserRegistry = execSuite.additionalRegistries.get('parsers');
  if(parserRegistry){
    return;
  }
  execSuite.additionalRegistries.add('parsers', new execSuite.RegistryBase());
}

module.exports = parserRegistryIntroducer;
