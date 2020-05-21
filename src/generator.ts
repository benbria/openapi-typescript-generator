import log from 'fancy-log';
import { promises as fs } from 'fs';
import { default as $RefParser } from 'json-schema-ref-parser';
// TODO: json-schema-to-typescript has a pretty major bug that makes it mess up
// a lot of types, but it gets simple schemas correct, so this is better than nothing.  :(
import { compile } from 'json-schema-to-typescript';
import traverseSchema from 'json-schema-traverse';
import ld from 'lodash';
import { OpenAPIObject, SchemaObject } from 'openapi3-ts';
import { findMostRecentChange } from './changeUtils';

function fixRefs(obj: any, prefix: string, replacement: string) {
    if (!obj) {
        return;
    }
    if (typeof obj === 'object') {
        if (obj.$ref) {
            obj.$ref = obj.$ref.replace(prefix, replacement);
        }
        for (const key of Object.keys(obj)) {
            fixRefs(obj[key], prefix, replacement);
        }
    }
}

// Adapted from from from
// https://github.com/exegesis-js/exegesis/blob/master/src/oas3/Schema/validators.ts#_filterRequiredProperties.
//
// This will remove all properties with "readOnly" or "writeOnly", whichever is passed in `propNametoFilter`.
function filterPropertiesWith(schema: any, propNameToFilter: 'readOnly' | 'writeOnly'): any {
    const result = ld.cloneDeep(schema);
    let modified = false;

    traverseSchema(result, (childSchema: SchemaObject) => {
        if (childSchema.properties && childSchema.required) {
            for (const propName of Object.keys(childSchema.properties)) {
                const prop = childSchema.properties[propName] as SchemaObject;

                if (prop && prop[propNameToFilter]) {
                    childSchema.required = childSchema.required.filter(
                        (r: string) => r !== propName
                    );
                    delete childSchema.properties[propName];
                    modified = true;
                }
            }
        }
    });

    return modified ? result : schema;
}

async function readPrettierConfig(prettierConfigFile: string) {
    const contents = await fs.readFile(prettierConfigFile, { encoding: 'utf-8' });
    try {
        return JSON.parse(contents);
    } catch (err) {
        try {
            return await require(prettierConfigFile);
        } catch (err) {
            log.warn(`Invalid prettier config file ${prettierConfigFile}: ${err}`);
            return undefined;
        }
    }
}

export async function buildOpenApiTypes(
    openapiDoc: string,
    outfile: string,
    options: {
        force?: boolean;
        changeGlob?: string;
        prettierConfigFile?: string;
    } = {}
): Promise<void> {
    const sourceTouchTime = options.changeGlob
        ? await findMostRecentChange('openapi/**/*.yaml')
        : undefined;
    const prettierConfig = options.prettierConfigFile
        ? await readPrettierConfig(options.prettierConfigFile)
        : undefined;

    let destTouchTime;
    try {
        destTouchTime = (await fs.stat(outfile)).mtimeMs;
    } catch (err) {
        destTouchTime = 0;
    }

    if (!options.force && sourceTouchTime && destTouchTime > sourceTouchTime) {
        log('build:openApiTypes - Skipping...');
        return;
    }

    log('build:openApiTypes - Building OpenApi generated types...');

    const openApiDoc = (await $RefParser.bundle(openapiDoc, {
        dereference: { circular: false },
    })) as OpenAPIObject;

    const definitions = openApiDoc.components?.schemas || {};
    fixRefs(definitions, '/components/schemas', '/definitions');

    // Set additionalProperties false for all types that don't explicitly set it.
    for (const schemaName of Object.keys(definitions)) {
        const schema = definitions[schemaName];

        traverseSchema(schema, {
            cb: {
                post: (node: SchemaObject) => {
                    if (!node.additionalProperties && !node.$ref) {
                        node.additionalProperties = false;
                    }
                },
            },
        });
    }

    const replacedSchemas = new Map();

    // For any schema that has a "readOnly" or "writeOnly", create a
    // 'Create' schema without the readOnly
    // Another way to declare such schema is to give it a
    // `x-benbria-needs-create: true` attribute.
    for (const schemaName of Object.keys(definitions)) {
        const schema = definitions[schemaName];

        let writeSchema = filterPropertiesWith(schema, 'readOnly');
        const readSchema = filterPropertiesWith(schema, 'writeOnly');

        const writeSchemaName = `${schemaName}Create`;

        if (
            readSchema !== schema ||
            writeSchema !== schema ||
            (schema as any)['x-benbria-needs-create']
        ) {
            if (definitions[writeSchemaName]) {
                throw new Error(`Name collision: ${schemaName}Create`);
            }
            writeSchema = writeSchema === schema ? ld.cloneDeep(writeSchema) : writeSchema;

            definitions[schemaName] = readSchema;
            definitions[writeSchemaName] = writeSchema;

            replacedSchemas.set(`#/definitions/${schemaName}`, {
                readSchemaName: schemaName,
                readSchema,
                writeSchemaName,
                writeSchema,
            });
        }
    }

    // If any writeSchema references another schema which has been converted
    // into a writeSchema, fix the reference.
    for (const { writeSchema } of replacedSchemas.values()) {
        traverseSchema(writeSchema, {
            cb: (node: SchemaObject) => {
                if (node.$ref && replacedSchemas.has(node.$ref)) {
                    const { writeSchemaName } = replacedSchemas.get(node.$ref);
                    node.$ref = `#/definitions/${writeSchemaName}`;
                }
            },
        });
    }

    const fakeSchema = {
        definitions,
    };

    // If anything is "nullable", make it so the type can be null.
    // `type: null` is invalid in OpenAPI 3, even though it's valid in JSONSchema,
    // but of course we're using json-schema-to-typescript, so we need it here.
    traverseSchema(fakeSchema, {
        cb: (
            node: SchemaObject,
            _jsonPtr,
            _rootSchema,
            _parentPtr,
            parentKeyword,
            parent: SchemaObject,
            property
        ) => {
            if (node.nullable) {
                parent[parentKeyword][property] = {
                    oneOf: [node, { type: 'null' }],
                };
            }
        },
    });

    const output = await compile(fakeSchema as any, 'root', {
        style: prettierConfig,
        unreachableDefinitions: true,
        bannerComment:
            '/* tslint:disable */\n' +
            '/* Automatically generated by gulp/tasks/build/openApiTypes.js.  Do not edit! */\n',
    });

    await fs.writeFile(outfile, output);

    log(`build:openApiTypes - Processed ${Object.keys(definitions).length} schemas.`);
}
