import {Block} from 'comment-parser';
import {PLUGIN_NAME} from './constants';

export type FunctionSettings = {
  private?: true;
  public?: true;
  system?: true;
  userId?: string;
  disableArgumentLogging?: true;
};
type RealmFunctionSettings = {
  name: string;
  private: boolean;
  run_as_system?: true;
  run_as_user_id?: string;
  disable_arg_logs?: true;
};
export function parseFunctionJSDoc(jsDoc: Block[]): FunctionSettings {
  const specs = jsDoc.flatMap(block => block.tags);

  const result = specs.reduce(
    (acc, spec) => {
      switch (spec.tag.toLowerCase()) {
        case 'public':
          acc.public = true;
          break;
        case 'private':
          acc.private = true;
          break;
        case 'system':
          acc.system = true;
          break;
        case 'user':
          acc.userId = spec.type;
          break;
        case 'logarguments':
          acc.disableArgumentLogging = ['', 'true'].includes(spec.type)
            ? undefined
            : true;
          break;
        default:
        // Deliberately do nothing
      }
      return acc;
    },
    {disableArgumentLogging: true} as FunctionSettings
  );

  return result;
}
export function validateFunctionSettings(
  settings: FunctionSettings,
  id: string
) {
  const result = {...settings};
  if (settings.private && settings.public) {
    console.log(
      `[${PLUGIN_NAME}]: Cannot have both private & public; setting as private in ${id}.`
    );

    delete result.public;
  }

  // TODO: Also handle script case when implemented
  if (settings.userId && settings.system) {
    console.log(
      `[${PLUGIN_NAME}]: Cannot have multiple authentications, setting as 'user' in ${id}.`
    );

    delete result.system;
  }

  return result;
}
export function functionSettingsToRealm(
  name: string,
  settings: FunctionSettings
): RealmFunctionSettings {
  return {
    name,
    private: settings.private || settings.public === undefined ? true : false,
    run_as_system: settings.system,
    run_as_user_id: settings.userId,
    disable_arg_logs: settings.disableArgumentLogging,
  };
}
