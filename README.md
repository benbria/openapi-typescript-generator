# @benbria/openapi-typescript-generator

[![NPM version](https://badge.fury.io/js/@benbria/openapi-typescript-generator.svg)](https://npmjs.org/package/@benbria/openapi-typescript-generator)

This is a command line tool for generating typescript types from an OpenAPI document.
Unlike Swagger Codegen or openapi-generator, this tries to be "smart" about readOnly
and writeOnly properties; if a type has one of these properties, this will generate
a type for reading, and a "Create" type for writing.

This would need quite a bit of work to generate the full client.
