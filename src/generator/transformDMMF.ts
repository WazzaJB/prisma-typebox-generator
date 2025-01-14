import type { DMMF } from '@prisma/generator-helper';

const transformField = (field: DMMF.Field) => {
  const tokens = [field.name + ':'];
  let inputTokens = [];
  const deps = new Set();

  if (['Int', 'Float', 'Decimal'].includes(field.type)) {
    tokens.push('Type.Number()');
  } else if (['BigInt'].includes(field.type)) {
    tokens.push('Type.Integer()');
  } else if (['String', 'Json'].includes(field.type)) {
    tokens.push('Type.String()');
  } else if (['DateTime', 'Date'].includes(field.type)) {
    tokens.push("Type.Unsafe<Date>({ type: 'string', format: 'date' })");
  } else if (field.type === 'Boolean') {
    tokens.push('Type.Boolean()');
  } else {
    tokens.push(`::${field.type}::`);
    deps.add(field.type);
  }

  if (field.isList) {
    tokens.splice(1, 0, 'Type.Array(');
    tokens.splice(tokens.length, 0, ')');
  }

  inputTokens = [...tokens];

  // @id cannot be optional except for input if it's auto increment
  if (field.isId && (field?.default as any)?.name === 'autoincrement') {
    inputTokens.splice(1, 0, 'Type.Optional(');
    inputTokens.splice(inputTokens.length, 0, ')');
  }

  if ((!field.isRequired || field.hasDefaultValue) && !field.isId) {
    // Prismas inputs are undefined (Type.Optional) but responses are nullable
    tokens.splice(1, 0, 'Type.Union([');
    tokens.splice(tokens.length, 0, ', Type.Null()])');
    inputTokens.splice(1, 0, 'Type.Optional(');
    inputTokens.splice(inputTokens.length, 0, ')');
  }

  return {
    str: tokens.join(' ').concat('\n'),
    strInput: inputTokens.join(' ').concat('\n'),
    deps,
  };
};

const transformFields = (fields: readonly DMMF.Field[]) => {
  let dependencies = new Set();
  const _fields: string[] = [];
  const _inputFields: string[] = [];

  fields.map(transformField).forEach((field) => {
    _fields.push(field.str);
    _inputFields.push(field.strInput);
    [...field.deps].forEach((d) => {
      dependencies.add(d);
    });
  });

  return {
    dependencies,
    rawString: _fields.filter((f) => !!f).join(','),
    rawInputString: _inputFields.filter((f) => !!f).join(','),
  };
};

const transformModel = (model: DMMF.Model, models?: readonly DMMF.Model[]) => {
  const fields = transformFields(model.fields);
  let raw = [
    `${models ? '' : `export const ${model.name} = `}Type.Object({\n\t`,
    fields.rawString,
    '})',
  ].join('\n');
  let inputRaw = [
    `${models ? '' : `export const ${model.name}Input = `}Type.Object({\n\t`,
    fields.rawInputString,
    '})',
  ].join('\n');

  if (Array.isArray(models)) {
    models.forEach((md) => {
      const re = new RegExp(`.+::${md.name}.+\n`, 'gm');
      const inputRe = new RegExp(`.+::${md.name}.+\n`, 'gm');
      raw = raw.replace(re, '');
      inputRaw = inputRaw.replace(inputRe, '');
    });
  }

  return {
    raw,
    inputRaw,
    deps: fields.dependencies,
  };
};

export const transformEnum = (enm: DMMF.DatamodelEnum) => {
  const values = enm.values
    .map((v) => `${v.name}: Type.Literal('${v.name}'),\n`)
    .join('');

  return [
    `export const ${enm.name}Const = {`,
    values,
    '}\n',
    `export const ${enm.name} = Type.KeyOf(Type.Object(${enm.name}Const))\n`,
    `export type ${enm.name}Type = Static<typeof ${enm.name}>`,
  ].join('\n');
};

export function transformDMMF(dmmf: DMMF.Document, config: any) {
  const { models, enums } = dmmf.datamodel;
  const importStatements = new Set([
    'import {Type, Static} from "@sinclair/typebox"',
  ]);

  return [
    ...models.map((model) => {
      let { raw, inputRaw, deps } = transformModel(model);

      [...deps].forEach((d) => {
        const depsModel = models.find((m) => m.name === d) as DMMF.Model;
        if (depsModel) {
          const replacer = transformModel(depsModel, models);
          const re = new RegExp(`::${d}::`, 'gm');
          raw = raw.replace(re, replacer.raw);
          inputRaw = inputRaw.replace(re, replacer.inputRaw);
        }
      });

      enums.forEach((enm) => {
        const re = new RegExp(`::${enm.name}::`, 'gm');
        if (raw.match(re)) {
          raw = raw.replace(re, enm.name);
          inputRaw = inputRaw.replace(re, enm.name);
          importStatements.add(
            `import { ${enm.name} } from './${enm.name}${
              config?.esmImports ? '.js' : ''
            }'`,
          );
        }
      });

      return {
        name: model.name,
        rawString: [
          [...importStatements].join('\n'),
          raw,
          `export type ${model.name}Type = Static<typeof ${model.name}>`,
        ].join('\n\n'),
        inputRawString: [
          [...importStatements].join('\n'),
          inputRaw,
          `export type ${model.name}InputType = Static<typeof ${model.name}Input>`,
        ].join('\n\n'),
      };
    }),
    ...enums.map((enm) => {
      return {
        name: enm.name,
        inputRawString: null,
        rawString:
          'import {Type, Static} from "@sinclair/typebox"\n\n' +
          transformEnum(enm),
      };
    }),
  ];
}
