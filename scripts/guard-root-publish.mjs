console.error(
  [
    'Refusing to publish the OmniWeave repository root package.',
    '',
    'This checkout is the source/development package. Build release bundles with',
    'scripts/build-bundle.sh, then generate the public npm shim packages with',
    'scripts/pack-npm.sh and publish release/npm/* instead.',
  ].join('\n'),
);

process.exit(1);
