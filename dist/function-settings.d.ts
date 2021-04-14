import { Block } from 'comment-parser';
export declare type FunctionSettings = {
    private?: true;
    public?: true;
    system?: true;
    userId?: string;
    disableArgumentLogging?: true;
};
declare type RealmFunctionSettings = {
    name: string;
    private: boolean;
    run_as_system?: true;
    run_as_user_id?: string;
    disable_arg_logs?: true;
};
export declare function parseFunctionJSDoc(jsDoc: Block[]): FunctionSettings;
export declare function validateFunctionSettings(settings: FunctionSettings, id: string): {
    private?: true | undefined;
    public?: true | undefined;
    system?: true | undefined;
    userId?: string | undefined;
    disableArgumentLogging?: true | undefined;
};
export declare function functionSettingsToRealm(name: string, settings: FunctionSettings): RealmFunctionSettings;
export {};
