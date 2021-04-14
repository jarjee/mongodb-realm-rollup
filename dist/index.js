'use strict';

var fs = require('fs');
var path = require('path');
var walkdir = require('walkdir');
var picomatch = require('picomatch');
var commentParser = require('comment-parser');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
var path__default = /*#__PURE__*/_interopDefaultLegacy(path);
var walkdir__default = /*#__PURE__*/_interopDefaultLegacy(walkdir);
var picomatch__default = /*#__PURE__*/_interopDefaultLegacy(picomatch);

const PLUGIN_NAME = 'mongodb-realm';

function parseFunctionJSDoc(jsDoc) {
    const specs = jsDoc.flatMap(block => block.tags);
    const result = specs.reduce((acc, spec) => {
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
            // Deliberately do nothing
        }
        return acc;
    }, { disableArgumentLogging: true });
    return result;
}
function validateFunctionSettings(settings, id) {
    const result = Object.assign({}, settings);
    if (settings.private && settings.public) {
        console.log(`[${PLUGIN_NAME}]: Cannot have both private & public; setting as private in ${id}.`);
        delete result.public;
    }
    // TODO: Also handle script case when implemented
    if (settings.userId && settings.system) {
        console.log(`[${PLUGIN_NAME}]: Cannot have multiple authentications, setting as 'user' in ${id}.`);
        delete result.system;
    }
    return result;
}
function functionSettingsToRealm(name, settings) {
    return {
        name,
        private: settings.private || settings.public === undefined ? true : false,
        run_as_system: settings.system,
        run_as_user_id: settings.userId,
        disable_arg_logs: settings.disableArgumentLogging,
    };
}

function isEmpty(x) {
    return x === undefined || x === '' || (Array.isArray(x) && x.length === 0);
}
function multiMap(v, fn) {
    if (Array.isArray(v)) {
        return v.map(fn);
    }
    return fn(v);
}
const functionSettingsCache = new Map();
function realm(pluginOptions) {
    return {
        name: PLUGIN_NAME,
        options: options => {
            const inputEntries = [];
            if (!isEmpty(options.input)) {
                console.error(`[${PLUGIN_NAME}]: You cannot specify inputs since we add them for you.`);
                return null;
            }
            const rootAbsolute = path__default['default'].resolve(pluginOptions.rootPath);
            const files = walkdir__default['default'].sync(pluginOptions.rootPath);
            if (pluginOptions.functions !== undefined) {
                const functionFiles = generateFunctionInputs(pluginOptions.functions, 'functions', rootAbsolute, files);
                inputEntries.push(...functionFiles);
            }
            if (pluginOptions.httpServices !== undefined) {
                const httpServiceFiles = generateFunctionInputs(pluginOptions.httpServices, 'services/main/incoming_webhooks', rootAbsolute, files);
                inputEntries.push(...httpServiceFiles);
            }
            const input = inputEntries.reduce((acc, [k, v]) => {
                acc[k] = v;
                return acc;
            }, {});
            return Object.assign(Object.assign({}, options), { input });
        },
        // Going to apply a very simple transform.
        // Could this be better? Definitely.
        transform: (code, id) => {
            // Test if the code has to be transformed
            if (!id.match(path__default['default'].join(pluginOptions.rootPath, 'functions'))) {
                return null;
            }
            if (!/export default/.test(code)) {
                console.warn(`[${PLUGIN_NAME}]: We expect 'export default' in ${id}`);
                return null;
            }
            // Dodgy comment parsing
            const jsDocMatch = /(\/\*\*.+\*\/).*export default/gms.exec(code);
            // If we find a JSDoc above the default export
            // Note: We check for 2 as the matches are:
            // - The complete regex
            // - The comment group we're interested in
            if ((jsDocMatch === null || jsDocMatch === void 0 ? void 0 : jsDocMatch.length) === 2) {
                const functionSettings = validateFunctionSettings(parseFunctionJSDoc(commentParser.parse(jsDocMatch[1])), id);
                functionSettingsCache.set(id, functionSettings);
            }
            return code.replace('export default', 'exports =');
        },
        // MongoDB Realm has a seperate dynamic import system
        resolveDynamicImport: () => false,
        // Adding all the extra metadata (config.json) if required
        writeBundle: (options, bundle) => {
            let httpService = false;
            for (const file of Object.values(bundle)) {
                if (file.type === 'chunk') {
                    const folder = path__default['default'].join(options.dir || 'build', file.fileName.replace('/source.js', ''));
                    const name = path__default['default'].basename(folder);
                    // Check if the config.json exists.
                    // If it does, merge with what we've parsed
                    // If it doesn't, create the config file
                    const configFile = path__default['default'].join(folder, 'config.json');
                    const rawOriginalConfig = fs__default['default'].existsSync(configFile) && fs__default['default'].readFileSync(configFile, 'utf8');
                    // If it's a function, use the default function config
                    if (/\/functions\//.test(configFile)) {
                        const parsedConfig = functionSettingsCache.get(file.facadeModuleId || '');
                        const functionConfig = parsedConfig
                            ? functionSettingsToRealm(name, parsedConfig)
                            : { name, private: true, disable_arg_logs: true };
                        fs__default['default'].writeFileSync(configFile, JSON.stringify(rawOriginalConfig
                            ? Object.assign({ id: JSON.parse(rawOriginalConfig).id }, functionConfig) : functionConfig, null, 4));
                    }
                    // Handling for the service config
                    if (/\/services\//.test(configFile)) {
                        httpService = true;
                        if (!rawOriginalConfig) {
                            fs__default['default'].writeFileSync(configFile, JSON.stringify({
                                name,
                                run_as_authed_user: true,
                                run_as_user_id: '',
                                run_as_user_id_script_source: '',
                                options: {
                                    httpMethod: 'POST',
                                    validationMethod: 'NO_VALIDATION',
                                },
                                respond_result: true,
                                disable_arg_logs: true,
                                fetch_custom_user_data: false,
                                create_user_on_auth: false,
                            }, null, 4));
                        }
                    }
                }
            }
            // If there was a 'service', generate the config if unavailable
            if (httpService) {
                const serviceConfig = path__default['default'].join(options.dir || 'build', 'services/main/config.json');
                fs__default['default'].existsSync(serviceConfig) ||
                    fs__default['default'].writeFileSync(serviceConfig, JSON.stringify({
                        name: 'main',
                        type: 'http',
                        config: {},
                        version: 1,
                    }, null, 4));
            }
        },
    };
}
function generateFunctionInputs(fileFilters, realmFolder, rootAbsolutePath, files) {
    const functionFilters = multiMap(fileFilters, f => path__default['default'].join(rootAbsolutePath, f));
    const functionFiles = files.filter(file => picomatch__default['default'].isMatch(file, functionFilters));
    return functionFiles.map(fnSource => [
        `${realmFolder}/${path__default['default']
            .basename(fnSource)
            .replace(/\.[^/.]+$/, '')}/source`,
        fnSource,
    ]);
}

module.exports = realm;
