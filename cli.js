import * as fs from 'node:fs/promises'
import readline from 'node:readline'
import {Writable} from 'node:stream'
import {X509Certificate} from 'node:crypto'
import {loadConfig} from './src/config.js'
import {run} from './src/core/exec.js'
import {checkAddressEntry} from './src/http/address.js'
import {AuthStore} from './src/auth/store.js'
import {checkNewPassword, generatePassword, hashPassword} from './src/auth/password.js'

const DEFAULT_USERNAME = 'admin'
const DEFAULT_SETTINGS_FILE = '.env'
const ALLOWED_IPS_NAME = 'ALLOWED_IPS'

const USAGE = [
    'Usage:',
    '  lnxeasy passwd                 Set the admin password (asks for it)',
    '  lnxeasy passwd --generate      Set a random admin password and print it',
    '  lnxeasy two-step --disable     Turn off two-step sign-in (when the phone is lost)',
    '  lnxeasy allow ADDRESS...       Let only these addresses connect (IP or range like 203.0.113.0/24)',
    '  lnxeasy allow --any            Let every address connect again',
    '  lnxeasy allowed                Show which addresses may connect',
    '  lnxeasy fingerprint            Show the fingerprint of the HTTPS certificate'
].join('\n')

function askHidden(question) {
    return new Promise((resolve) => {
        const silentOutput = new Writable({
            write(chunk, encoding, callback) {
                callback()
            }
        })

        process.stdout.write(question)

        const prompt = readline.createInterface({
            input: process.stdin,
            output: silentOutput,
            terminal: true
        })

        prompt.question('', (answer) => {
            prompt.close()
            process.stdout.write('\n')
            resolve(answer)
        })
    })
}

async function askNewPassword() {
    const password = await askHidden('New password: ')
    checkNewPassword(password)

    const repeated = await askHidden('Repeat it: ')
    if (password !== repeated) {
        throw new Error('The passwords do not match')
    }

    return password
}

async function restartService() {
    const service = process.env.LNXEASY_SERVICE
    if (service === undefined || service === '') {
        console.log('Restart lnxeasy to apply the change.')
        return
    }

    try {
        await run('systemctl', ['restart', service])
        console.log('lnxeasy was restarted.')
    } catch (e) {
        console.log('Could not restart lnxeasy. Run as root: systemctl restart ' + service)
    }
}

async function setPassword(store, generate) {
    let password = ''
    if (generate) {
        password = generatePassword()
    } else {
        password = await askNewPassword()
    }

    let username = DEFAULT_USERNAME
    let totpSecret = null
    const existing = await store.load()
    if (existing !== null) {
        username = existing.username
        totpSecret = existing.totpSecret
    }

    const hashed = await hashPassword(password)
    await store.save({
        username: username,
        salt: hashed.salt,
        hash: hashed.hash,
        totpSecret: totpSecret
    })

    if (generate) {
        console.log('Username: ' + username)
        console.log('Password: ' + password)
        return
    }

    console.log('The password for "' + username + '" was changed.')
    await restartService()
}

async function disableTwoStep(store) {
    const account = await store.load()
    if (account === null) {
        throw new Error('The admin account does not exist yet')
    }

    await store.save({
        username: account.username,
        salt: account.salt,
        hash: account.hash,
        totpSecret: null
    })

    console.log('Two-step sign-in is off. Sign in with the password alone and set it up again.')
}

function settingsFilePath() {
    const fromEnvironment = process.env.LNXEASY_CONFIG_FILE
    if (fromEnvironment === undefined || fromEnvironment === '') {
        return DEFAULT_SETTINGS_FILE
    }

    return fromEnvironment
}

async function writeAllowedAddresses(addresses) {
    const filePath = settingsFilePath()

    let text = ''
    try {
        text = await fs.readFile(filePath, 'utf8')
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e
        }
    }

    const lines = []
    for (const line of text.split('\n')) {
        if (line.startsWith(ALLOWED_IPS_NAME + '=') || line === '') {
            continue
        }
        lines.push(line)
    }

    if (addresses.length > 0) {
        lines.push(ALLOWED_IPS_NAME + '=' + addresses.join(','))
    }

    await fs.writeFile(filePath, lines.join('\n') + '\n')
}

async function allowAddresses(args) {
    if (args.length === 1 && args[0] === '--any') {
        await writeAllowedAddresses([])
        console.log('Every address may connect.')
        await restartService()
        return
    }

    for (const address of args) {
        checkAddressEntry(address)
    }

    await writeAllowedAddresses(args)
    console.log('Only these addresses may connect: ' + args.join(', '))
    console.log('Connections from this machine itself are always allowed.')
    await restartService()
}

function showAllowed(config) {
    if (config.allowedAddresses.length === 0) {
        console.log('Every address may connect.')
        return
    }

    console.log('Only these addresses may connect: ' + config.allowedAddresses.join(', '))
}

async function showFingerprint(config) {
    if (config.tls === null) {
        throw new Error('HTTPS is not configured')
    }

    const certificate = new X509Certificate(await fs.readFile(config.tls.certFile))
    console.log('SHA-256 fingerprint: ' + certificate.fingerprint256)
    console.log('Valid until:         ' + certificate.validTo)
}

async function main() {
    const args = process.argv.slice(2)
    const command = args[0]
    const rest = args.slice(1)
    const config = loadConfig(process.env)
    const store = new AuthStore(config.authFile, fs)

    if (command === 'passwd' && rest.length === 0) {
        await setPassword(store, false)
        return
    }

    if (command === 'passwd' && rest.length === 1 && rest[0] === '--generate') {
        await setPassword(store, true)
        return
    }

    if (command === 'two-step' && rest.length === 1 && rest[0] === '--disable') {
        await disableTwoStep(store)
        return
    }

    if (command === 'allow' && rest.length > 0) {
        await allowAddresses(rest)
        return
    }

    if (command === 'allowed' && rest.length === 0) {
        showAllowed(config)
        return
    }

    if (command === 'fingerprint' && rest.length === 0) {
        await showFingerprint(config)
        return
    }

    console.log(USAGE)
    process.exitCode = 1
}

try {
    await main()
} catch (e) {
    console.error('Error: ' + e.message)
    process.exitCode = 1
}
