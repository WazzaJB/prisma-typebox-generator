import { generatorHandler } from '@prisma/generator-helper';
import { transformDMMF } from './generator/transformDMMF';
import * as fs from 'fs';
import * as path from 'path';
import prettier from 'prettier';

generatorHandler({
  onManifest() {
    return {
      defaultOutput: './typebox',
      prettyName: 'Prisma Typebox Generator',
    };
  },
  async onGenerate(options) {
    const config = options.generator.config;
    const payload = transformDMMF(options.dmmf, config);
    if (options.generator.output) {
      const outputDir =
        // This ensures previous version of prisma are still supported
        typeof options.generator.output === 'string'
          ? (options.generator.output as unknown as string)
          : // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            (options.generator.output.value as string);

      try {
        await fs.promises.mkdir(outputDir, {
          recursive: true,
        });
        const barrelFile = path.join(outputDir, 'index.ts');
        await fs.promises.writeFile(barrelFile, '', {
          encoding: 'utf-8',
        });
        await Promise.all(
          payload.map(async (n) => {
            const fsPromises = [];
            fsPromises.push(
              fs.promises.writeFile(
                path.join(outputDir, n.name + '.ts'),
                await prettier.format(n.rawString, {
                  parser: 'babel-ts',
                }),
                {
                  encoding: 'utf-8',
                },
              ),
            );

            fsPromises.push(
              fs.promises.appendFile(
                barrelFile,
                `export * from './${n.name}${
                  config?.esmImports ? '.js' : ''
                }';\n`,
                { encoding: 'utf-8' },
              ),
            );
            if (n.inputRawString) {
              fsPromises.push(
                fs.promises.writeFile(
                  path.join(outputDir, n.name + 'Input.ts'),
                  await prettier.format(n.inputRawString, {
                    parser: 'babel-ts',
                  }),
                  {
                    encoding: 'utf-8',
                  },
                ),
              );
              fsPromises.push(
                fs.promises.appendFile(
                  barrelFile,
                  `export * from './${n.name}Input${
                    config?.esmImports ? '.js' : ''
                  }';\n`,
                  { encoding: 'utf-8' },
                ),
              );
            }

            return Promise.all(fsPromises);
          }),
        );
      } catch (e) {
        console.error(
          'Error: unable to write files for Prisma Typebox Generator',
        );
        throw e;
      }
    } else {
      throw new Error('No output was specified for Prisma Typebox Generator');
    }
  },
});
