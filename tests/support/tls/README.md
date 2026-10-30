# Local browser-test TLS

The adjacent self-signed certificate and public test private key are fixtures for
the isolated HTTPS browser runner at 127.0.0.1. They have no trust or use outside
tests and are not account, database or deployment credentials. Playwright ignores
certificate trust errors only in its test configuration. Never use these fixtures
for staging or production.

Regenerate with OpenSSL from the repository root:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout tests/support/tls/localhost-test.key -out tests/support/tls/localhost-test.crt -days 3650 -subj /CN=localhost -addext subjectAltName=IP:127.0.0.1,DNS:localhost
```
