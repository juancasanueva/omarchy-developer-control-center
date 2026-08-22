#!/usr/bin/env python3
"""Atomically snapshot one bounded, no-follow regular file."""

import errno
import os
import stat
import sys


EX_DATAERR = 65
EX_NOINPUT = 66
EX_IOERR = 74
CHUNK_SIZE = 64 * 1024


class SnapshotFailure(Exception):
    pass


def snapshot(source, destination, cap):
    partial = f"{destination}.partial.{os.getpid()}"
    source_fd = None
    partial_fd = None
    committed = False
    status = EX_IOERR

    try:
        source_fd = os.open(
            source,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
        )
    except OSError as error:
        if error.errno == errno.ENOENT:
            return EX_NOINPUT
        return EX_IOERR

    try:
        source_stat = os.fstat(source_fd)
        if not stat.S_ISREG(source_stat.st_mode):
            raise SnapshotFailure

        partial_fd = os.open(
            partial,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | os.O_NOFOLLOW
            | os.O_CLOEXEC,
            0o600,
        )

        observed = 0
        limit = cap + 1
        while observed < limit:
            chunk = os.read(source_fd, min(CHUNK_SIZE, limit - observed))
            if not chunk:
                break
            observed += len(chunk)
            offset = 0
            while offset < len(chunk):
                written = os.write(partial_fd, chunk[offset:])
                if written == 0:
                    raise SnapshotFailure
                offset += written

        if observed > cap:
            status = EX_DATAERR
        else:
            os.close(partial_fd)
            partial_fd = None
            os.close(source_fd)
            source_fd = None
            os.replace(partial, destination)
            committed = True
            status = 0
    except (OSError, OverflowError, SnapshotFailure, ValueError):
        status = EX_IOERR
    finally:
        for descriptor in (partial_fd, source_fd):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    status = EX_IOERR
        if not committed:
            try:
                os.unlink(partial)
            except FileNotFoundError:
                pass
            except OSError:
                status = EX_IOERR

    return status


def main(argv):
    if len(argv) != 4:
        return EX_IOERR
    try:
        cap = int(argv[3], 10)
        if cap < 0:
            return EX_IOERR
        return snapshot(argv[1], argv[2], cap)
    except (OSError, OverflowError, ValueError):
        return EX_IOERR


if __name__ == "__main__":
    sys.exit(main(sys.argv))
