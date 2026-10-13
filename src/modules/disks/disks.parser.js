const DISK_TYPES = [
    'ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'jfs', 'reiserfs',
    'vfat', 'exfat', 'ntfs', 'ntfs3', 'fuseblk',
    'nfs', 'nfs4', 'cifs', 'smb3'
]

function unescapeMountText(text) {
    return text
        .split('\\040').join(' ')
        .split('\\011').join('\t')
        .split('\\012').join('\n')
        .split('\\134').join('\\')
}

export function parseMounts(text) {
    const mounts = []
    const seenDevices = []

    for (const line of text.split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 3) {
            continue
        }

        const device = unescapeMountText(parts[0])
        const type = parts[2]

        if (!DISK_TYPES.includes(type) || seenDevices.includes(device)) {
            continue
        }

        seenDevices.push(device)
        mounts.push({
            device: device,
            mountPoint: unescapeMountText(parts[1]),
            type: type
        })
    }

    return mounts
}
