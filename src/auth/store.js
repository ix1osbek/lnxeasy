import path from 'node:path'

export class AuthStore {
    constructor(filePath, fs) {
        this.filePath = filePath
        this.fs = fs
    }

    async load() {
        let text = ''
        try {
            text = await this.fs.readFile(this.filePath, 'utf8')
        } catch (e) {
            if (e.code === 'ENOENT') {
                return null
            }
            throw e
        }

        let account = null
        try {
            account = JSON.parse(text)
        } catch (e) {
            throw new Error('Invalid auth file: ' + this.filePath)
        }

        if (account === null || typeof account !== 'object') {
            throw new Error('Invalid auth file: ' + this.filePath)
        }

        if (typeof account.username !== 'string' || typeof account.salt !== 'string' || typeof account.hash !== 'string') {
            throw new Error('Invalid auth file: ' + this.filePath)
        }

        let totpSecret = null
        if (typeof account.totpSecret === 'string' && account.totpSecret !== '') {
            totpSecret = account.totpSecret
        }

        return {
            username: account.username,
            salt: account.salt,
            hash: account.hash,
            totpSecret: totpSecret
        }
    }

    async save(account) {
        const directory = path.dirname(this.filePath)
        const temporaryPath = this.filePath + '.tmp'
        let totpSecret = null
        if (typeof account.totpSecret === 'string' && account.totpSecret !== '') {
            totpSecret = account.totpSecret
        }

        const text = JSON.stringify({
            username: account.username,
            salt: account.salt,
            hash: account.hash,
            totpSecret: totpSecret
        }, null, 2) + '\n'

        await this.fs.mkdir(directory, {recursive: true, mode: 0o700})
        await this.fs.writeFile(temporaryPath, text, {mode: 0o600})
        await this.fs.chmod(temporaryPath, 0o600)
        await this.fs.rename(temporaryPath, this.filePath)

        await this.giveToDirectoryOwner(directory)
    }

    async giveToDirectoryOwner(directory) {
        const directoryInfo = await this.fs.stat(directory)

        try {
            await this.fs.chown(this.filePath, directoryInfo.uid, directoryInfo.gid)
        } catch (e) {
            if (e.code !== 'EPERM') {
                throw e
            }
        }
    }
}
