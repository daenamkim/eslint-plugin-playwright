# Require promises that have expectations in their chain to be valid (`valid-expect-in-promise`)

Ensure promises that include expectations are returned or awaited.

## Rule details

This rule flags any promises within the body of a test that include expectations
that have either not been returned or awaited.

The following patterns are considered warnings:

```js
test('promises a person', () => {
  api.getPersonByName('bob').then((person) => {
    expect(person).toHaveProperty('name', 'Bob');
  });
});

test('promises a counted person', () => {
  const promise = api.getPersonByName('bob').then((person) => {
    expect(person).toHaveProperty('name', 'Bob');
  });

  promise.then(() => {
    expect(analytics.gottenPeopleCount).toBe(1);
  });
});

test('promises multiple people', () => {
  const firstPromise = api.getPersonByName('bob').then((person) => {
    expect(person).toHaveProperty('name', 'Bob');
  });
  const secondPromise = api.getPersonByName('alice').then((person) => {
    expect(person).toHaveProperty('name', 'Alice');
  });

  return Promise.any([firstPromise, secondPromise]);
});
```

The following pattern is not a warning:

```js
test('promises a person', async () => {
  await api.getPersonByName('bob').then((person) => {
    expect(person).toHaveProperty('name', 'Bob');
  });
});

test('promises a counted person', () => {
  let promise = api.getPersonByName('bob').then((person) => {
    expect(person).toHaveProperty('name', 'Bob');
  });

  promise = promise.then(() => {
    expect(analytics.gottenPeopleCount).toBe(1);
  });

  return promise;
});

test('promises multiple people', () => {
  const firstPromise = api.getPersonByName('bob').then((person) => {
    expect(person).toHaveProperty('name', 'Bob');
  });
  const secondPromise = api.getPersonByName('alice').then((person) => {
    expect(person).toHaveProperty('name', 'Alice');
  });

  return Promise.allSettled([firstPromise, secondPromise]);
});
```
