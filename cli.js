import * as fs from 'node:fs/promises'
import readline from 'node:readline'
import {Writable} from 'node:stream'
import {loadConfig} from './src/config.js'
import {AuthStore} from './src/auth/store.js'
import {checkNewPassword, generatePassword, hashPassword} from './src/auth/password.js'

const DEFAULT_USERNAME = 'admin'

const USAGE = [
    'Usage:',
    '  lnxeasy passwd              Set the admin password (asks for it)',
    '  lnxeasy passwd --generate   Set a random admin password and print it'
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

async function setPassword(store, generate) {
    let password = ''
    if (generate) {
        password = generatePassword()
    } else {
        password = await askNewPassword()
    }

    let username = DEFAULT_USERNAME
    const existing = await store.load()
    if (existing !== null) {
        username = existing.username
    }

    const hashed = await hashPassword(password)
    await store.save({
        username: username,
        salt: hashed.salt,
        hash: hashed.hash
    })

    if (generate) {
        console.log('Username: ' + username)
        console.log('Password: ' + password)
    } else {
        console.log('The password for "' + username + '" was changed.')
        console.log('Restart lnxeasy to sign out the sessions that are still open.')
    }
}

async function main() {
    const args = process.argv.slice(2)
    const config = loadConfig(process.env)
    const store = new AuthStore(config.authFile, fs)

    if (args[0] === 'passwd' && args.length === 1) {
        await setPassword(store, false)
        return
    }

    if (args[0] === 'passwd' && args[1] === '--generate' && args.length === 2) {
        await setPassword(store, true)
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
