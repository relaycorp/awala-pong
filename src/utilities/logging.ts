import { getPinoOptions, type LoggingTarget } from '@relaycorp/pino-cloud';
import env from 'env-var';
import { type Level, type Logger, pino } from 'pino';

const DEFAULT_APP_NAME = 'awala-pong';

export function makeLogger(): Logger {
  const logTarget = env.get('LOG_TARGET').asString();
  const gatewayVersion = env.get('VERSION').required().asString();
  const logEnvironmentName = env.get('LOG_ENV_NAME').default(DEFAULT_APP_NAME).asString();
  const appContext = { name: logEnvironmentName, version: gatewayVersion };
  const cloudPinoOptions = getPinoOptions(logTarget as LoggingTarget, appContext);

  const logLevel = env.get('LOG_LEVEL').default('info').asString().toLowerCase() as Level;
  return pino({ ...cloudPinoOptions, level: logLevel });
}
