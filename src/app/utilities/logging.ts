import { getPinoOptions, LoggingTarget } from '@relaycorp/pino-cloud';
import { get as getEnvVar } from 'env-var';
import pino, { Level, Logger } from 'pino';

const DEFAULT_APP_NAME = 'awala-pong';

export function makeLogger(): Logger {
  const logTarget = getEnvVar('LOG_TARGET').asString();
  const appVersion = getEnvVar('APP_VERSION').required().asString();
  const logEnvName = getEnvVar('LOG_ENV_NAME').default(DEFAULT_APP_NAME).asString();
  const appContext = { name: logEnvName, version: appVersion };
  const cloudPinoOptions = getPinoOptions(logTarget as LoggingTarget, appContext);

  const logLevel = getEnvVar('LOG_LEVEL').default('info').asString().toLowerCase() as Level;
  return pino({ ...cloudPinoOptions, level: logLevel });
}
