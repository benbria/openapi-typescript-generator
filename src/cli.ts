import yargs from 'yargs';
import { buildOpenApiTypes } from './generator';

function getOptions() {
    return yargs
        .reset()
        .strict()
        .usage(
            `
    Generate typescript types for an openapi document.
    Usage: $0 -o ./generatedTypes.ts ./openapi.yaml
`
        )
        .option('output', {
            alias: 'o',
            string: true,
            describe: 'The typescript file to generate.',
        })
        // .option('change', {
        //     alias: 'c',
        //     string: true,
        //     describe: 'A glob string - if none of these files have been touched since the output file was written, generation will be skipped.',
        // })
        .option('prettierConfig', {
            alias: 'p',
            string: true,
            describe: 'Path to prettier config to apply.'
        })
        .help('h')
        .alias('h', 'help')
        .demand(1).argv; // Need 2 non-hyphenated arguments
}

function main() {
    const options = getOptions();
    const openapiDoc = options._[0];
    const outfile = options.output || 'generatedTypes.ts';
    buildOpenApiTypes(openapiDoc, outfile, {
        force: true,
        prettierConfigFile: options.prettierConfig
    });
}

main();