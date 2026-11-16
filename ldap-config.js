//Resuelve las URLs de LDAP según el protocolo del servidor:
//PROTOCOL=http  -> ldap://...:389
//PROTOCOL=https -> ldaps://...:636
const fs = require('fs');
const path = require('path');

const getLdapUrls = (protocol, urls = []) => {
    const secure = 'https' == String(protocol).toLowerCase();
    const scheme = secure ? 'ldaps:' : 'ldap:';
    const defaultPort = secure ? '636' : '389';

    return urls.map((url) => {
        const parsed = new URL(url);
        const usesDefaultPort = ! parsed.port || ['389', '636'].includes(parsed.port);

        parsed.protocol = scheme;

        if (usesDefaultPort) {
            parsed.port = defaultPort;
        }

        return `${parsed.protocol}//${parsed.host}`;
    });
};

//Opciones TLS para ldaps (solo se usan cuando PROTOCOL=https).
const getLdapTlsOptions = (env = process.env) => {
    const options = {
        rejectUnauthorized: 'false' !== String(env?.LDAP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase()
    };

    if (env?.LDAP_TLS_CA) {
        options.ca = [fs.readFileSync(path.resolve(env.LDAP_TLS_CA))];
    }

    return options;
};

module.exports = { getLdapUrls, getLdapTlsOptions };
