# Functional test suite

As functional tests, the tests in this directory must adhere to the following constraints:

- The app must be tested over the network.
- Backing services shouldn't be accessed from the tests, except for any service that we must mock with [MockServer](https://mock-server.com).
- The executed code must not count towards the **unit** test coverage.
