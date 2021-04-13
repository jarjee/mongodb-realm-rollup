import fs from 'fs';
import path from 'path';
import walkdir from 'walkdir';
import picomatch from 'picomatch';

function isEmpty(x) {
    return x === undefined || x === '' || (Array.isArray(x) && x.length === 0);
}
function multiMap(v, fn) {
    if (Array.isArray(v)) {
        return v.map(fn);
    }
    return fn(v);
}
function realm(pluginOptions) {
    return {
        name: 'mongodb-realm',
        options: options => {
            const inputEntries = [];
            if (!isEmpty(options.input)) {
                console.warn('[mongodb-realm]: You cannot specify inputs since we mangle them for you.');
                return null;
            }
            const rootAbsolute = path.resolve(pluginOptions.rootPath);
            const files = walkdir.sync(pluginOptions.rootPath);
            if (pluginOptions.functions !== undefined) {
                const functionFilters = multiMap(pluginOptions.functions, f => path.join(rootAbsolute, f));
                const functionFiles = files.filter(file => picomatch.isMatch(file, functionFilters));
                inputEntries.push(...functionFiles.map(fnSource => [
                    `functions/${path
                        .basename(fnSource)
                        .replace(/\.[^/.]+$/, '')}/source`,
                    fnSource,
                ]));
            }
            const input = inputEntries.reduce((acc, [k, v]) => {
                acc[k] = v;
                return acc;
            }, {});
            return Object.assign(Object.assign({}, options), { input });
        },
        // Going to apply a very simple transform.
        // Could this be better? Definitely.
        transform: code => {
            return code.replace('export default', 'exports =');
        },
        // MongoDB Realm has a seperate dynamic import system
        resolveDynamicImport: () => false,
        // Adding all the extra metadata (config.json) if required
        writeBundle: (options, bundle) => {
            for (const file of Object.values(bundle)) {
                if (file.type === 'chunk') {
                    const folder = path.join(options.dir || 'dir', file.fileName.replace('/source.js', ''));
                    // Check if the config.json exists.
                    // If it does, leave it alone.
                    // If it doesn't, create the config file
                    const configFile = path.join(folder, 'config.json');
                    if (!fs.existsSync(configFile)) {
                        const config = { name: path.basename(folder), private: true };
                        fs.writeFileSync(configFile, JSON.stringify(config, null, 4));
                    }
                }
            }
        },
    };
}

export default realm;
