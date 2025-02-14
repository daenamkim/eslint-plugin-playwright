import dedent from 'dedent';
import { runRuleTester } from '../utils/rule-tester';
import rule from './valid-describe-callback';

runRuleTester('valid-describe-callback', rule, {
  invalid: [
    {
      code: 'test.describe(() => {})',
      errors: [{ column: 15, line: 1, messageId: 'nameAndCallback' }],
    },
    {
      code: 'describe(() => {})',
      errors: [{ column: 10, line: 1, messageId: 'nameAndCallback' }],
    },
    {
      code: 'test.describe("foo")',
      errors: [{ column: 15, line: 1, messageId: 'nameAndCallback' }],
    },
    {
      code: 'test.describe("foo", "foo2")',
      errors: [
        { column: 15, line: 1, messageId: 'secondArgumentMustBeFunction' },
      ],
    },
    {
      code: 'test.describe()',
      errors: [{ column: 1, line: 1, messageId: 'nameAndCallback' }],
    },
    {
      code: 'test.describe("foo", async () => {})',
      errors: [{ column: 22, line: 1, messageId: 'noAsyncDescribeCallback' }],
    },
    {
      code: 'test.describe("foo", async function () {})',
      errors: [{ column: 22, line: 1, messageId: 'noAsyncDescribeCallback' }],
    },
    {
      code: 'test.describe.only("foo", async function () {})',
      errors: [{ column: 27, line: 1, messageId: 'noAsyncDescribeCallback' }],
    },
    {
      code: 'test.describe.skip("foo", async function () {})',
      errors: [{ column: 27, line: 1, messageId: 'noAsyncDescribeCallback' }],
    },
    {
      code: dedent`
        test.describe('sample case', () => {
          test('works', () => {
            expect(true).toEqual(true);
          });
          test.describe('async', async () => {
            await new Promise(setImmediate);
            test('breaks', () => {
              throw new Error('Fail');
            });
          });
        });
      `,
      errors: [{ column: 26, line: 5, messageId: 'noAsyncDescribeCallback' }],
    },
    {
      code: dedent`
        test.describe('foo', function () {
          return Promise.resolve().then(() => {
            test('breaks', () => {
              throw new Error('Fail')
            })
          })
        })
      `,
      errors: [{ column: 3, line: 2, messageId: 'unexpectedReturnInDescribe' }],
    },
    {
      code: dedent`
        test.describe('foo', () => {
          return Promise.resolve().then(() => {
            test('breaks', () => {
              throw new Error('Fail')
            })
          })
          test.describe('nested', () => {
            return Promise.resolve().then(() => {
              test('breaks', () => {
                throw new Error('Fail')
              })
            })
          })
        })
      `,
      errors: [
        { column: 3, line: 2, messageId: 'unexpectedReturnInDescribe' },
        { column: 5, line: 8, messageId: 'unexpectedReturnInDescribe' },
      ],
    },
    {
      code: dedent`
        test.describe('foo', async () => {
          await something()
          test('does something')
          test.describe('nested', () => {
            return Promise.resolve().then(() => {
              test('breaks', () => {
                throw new Error('Fail')
              })
            })
          })
        })
      `,
      errors: [
        { column: 22, line: 1, messageId: 'noAsyncDescribeCallback' },
        { column: 5, line: 5, messageId: 'unexpectedReturnInDescribe' },
      ],
    },
    {
      code: dedent`
        test.describe('foo', () =>
          test('bar', () => {})
        )
      `,
      errors: [
        { column: 22, line: 1, messageId: 'unexpectedReturnInDescribe' },
      ],
    },
    {
      code: 'describe("foo", done => {})',
      errors: [
        { column: 17, line: 1, messageId: 'unexpectedDescribeArgument' },
      ],
    },
    {
      code: 'describe("foo", function (done) {})',
      errors: [
        { column: 27, line: 1, messageId: 'unexpectedDescribeArgument' },
      ],
    },
    {
      code: 'describe("foo", function (one, two, three) {})',
      errors: [
        { column: 27, line: 1, messageId: 'unexpectedDescribeArgument' },
      ],
    },
    {
      code: 'describe("foo", async function (done) {})',
      errors: [
        { column: 17, line: 1, messageId: 'noAsyncDescribeCallback' },
        { column: 33, line: 1, messageId: 'unexpectedDescribeArgument' },
      ],
    },
    // Global aliases
    {
      code: 'it.describe(() => {})',
      errors: [{ column: 13, line: 1, messageId: 'nameAndCallback' }],
      settings: {
        playwright: {
          globalAliases: { test: ['it'] },
        },
      },
    },
  ],
  valid: [
    'test.describe("foo", function() {})',
    'test.describe("foo", () => {})',
    'test.describe(`foo`, () => {})',
    'test.describe.only("foo", () => {})',
    'describe("foo", () => {})',
    'describe.only("foo", () => {})',
    dedent`
      test.describe('foo', () => {
        test('bar', () => {
          return Promise.resolve(42).then(value => {
            expect(value).toBe(42)
          })
        })
      })
    `,
    dedent`
      test.describe('foo', () => {
        test('bar', async () => {
          expect(await Promise.resolve(42)).toBe(42)
        })
      })
    `,
    dedent`
      if (hasOwnProperty(obj, key)) {
      }
    `,
    // Global aliases
    {
      code: 'it.describe("foo", function() {})',
      settings: {
        playwright: {
          globalAliases: { test: ['it'] },
        },
      },
    },
  ],
});
