import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMounts } from '../src/modules/disks/disks.parser.js'
import { DisksService } from '../src/modules/disks/disks.service.js'

const MOUNTS = [
    'sysfs /sys sysfs rw,nosuid 0 0',
    'proc /proc proc rw 0 0',
    'udev /dev devtmpfs rw 0 0',
    '/dev/sda2 / ext4 rw,relatime 0 0',
    'tmpfs /run tmpfs rw 0 0',
    '/dev/loop0 /snap/core/1 squashfs ro 0 0',
    '/dev/sda1 /boot/efi vfat rw 0 0',
    'overlay /var/lib/docker/overlay2/abc/merged overlay rw 0 0',
    '/dev/sdb1 /mnt/My\\040Backups xfs rw 0 0',
    '/dev/sda2 /var/snap/bind ext4 rw 0 0',
    '',
].join('\n')

function createFakeFs(sizes) {
    return {
        readFile: async (path) => {
            assert.equal(path, '/proc/mounts')
            return MOUNTS
        },
        statfs: async (path) => {
            if (sizes[path] === undefined) {
                const error = new Error('permission denied')
                error.code = 'EACCES'
                throw error
            }
            return sizes[path]
        },
    }
}

test('parseMounts keeps real disks and drops system and container filesystems', () => {
    const mounts = parseMounts(MOUNTS)

    assert.deepEqual(mounts.map((mount) => mount.mountPoint), ['/', '/boot/efi', '/mnt/My Backups'])
    assert.deepEqual(mounts[0], { device: '/dev/sda2', mountPoint: '/', type: 'ext4' })
})

test('parseMounts lists a device once even when it is mounted twice', () => {
    const mounts = parseMounts(MOUNTS)

    assert.equal(mounts.filter((mount) => mount.device === '/dev/sda2').length, 1)
})

test('parseMounts copes with empty and broken lines', () => {
    assert.deepEqual(parseMounts(''), [])
    assert.deepEqual(parseMounts('garbage\n\n/dev/sda1\n'), [])
})

test('list reports total, used and available space in bytes', async () => {
    const service = new DisksService(createFakeFs({
        '/': { bsize: 4096, blocks: 1000, bfree: 400, bavail: 300 },
        '/boot/efi': { bsize: 512, blocks: 200, bfree: 100, bavail: 100 },
        '/mnt/My Backups': { bsize: 4096, blocks: 500, bfree: 500, bavail: 500 },
    }))

    const disks = await service.list()

    assert.deepEqual(disks[0], {
        device: '/dev/sda2',
        mountPoint: '/',
        type: 'ext4',
        totalBytes: 4096000,
        usedBytes: 2457600,
        availableBytes: 1228800,
        usedPercent: 66.7,
    })
    assert.deepEqual(disks.map((disk) => disk.mountPoint), ['/', '/boot/efi', '/mnt/My Backups'])
    assert.equal(disks[2].usedPercent, 0)
})

test('list leaves out a disk that cannot be read or has no size', async () => {
    const service = new DisksService(createFakeFs({
        '/': { bsize: 4096, blocks: 1000, bfree: 400, bavail: 300 },
        '/boot/efi': { bsize: 512, blocks: 0, bfree: 0, bavail: 0 },
    }))

    const disks = await service.list()

    assert.deepEqual(disks.map((disk) => disk.mountPoint), ['/'])
})
