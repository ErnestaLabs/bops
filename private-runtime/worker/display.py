"""Four local X displays, with all input/outputs confined to this worker."""
import fcntl
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DISPLAYS = (99, 100, 101, 102)
ROOT = Path('/tmp/ernesta-displays')
ROOT.mkdir(mode=0o700, exist_ok=True)

def exists(n):
    return subprocess.run(['xdpyinfo', '-display', f':{n}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

def start(n):
    if exists(n):
        return
    log = open(ROOT / f'{n}.log', 'ab', buffering=0)
    proc = subprocess.Popen(['Xvfb', f':{n}', '-screen', '0', '1280x960x24', '-nolisten', 'tcp'], stdout=log, stderr=log, start_new_session=True)
    (ROOT / f'{n}.pid').write_text(str(proc.pid))
    for _ in range(100):
        if exists(n):
            env = dict(os.environ, DISPLAY=f':{n}')
            subprocess.Popen(['openbox'], env=env, stdout=log, stderr=log, start_new_session=True)
            subprocess.Popen(['bops-chrome', str(n)], env=env, stdout=log, stderr=log, start_new_session=True)
            return
        if proc.poll() is not None:
            raise RuntimeError('Display failed to start')
        time.sleep(.1)
    raise TimeoutError('Display not ready')

if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'list':
        print(json.dumps([n for n in DISPLAYS if exists(n)]))
    elif command in ('boot', 'create'):
        with open(ROOT / 'lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            for n in DISPLAYS:
                if not exists(n):
                    start(n)
                    if command == 'create':
                        print(n)
                        break
            else:
                if command == 'create':
                    raise RuntimeError('All four screens already exist')
    elif command == 'remove':
        n = int(sys.argv[2])
        if n not in DISPLAYS or n == 99:
            raise ValueError('Invalid removable display')
        pid = int((ROOT / f'{n}.pid').read_text())
        # Check PID identity, not only a stale PID file.
        args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        if b'Xvfb' not in args or f':{n}'.encode() not in args:
            raise RuntimeError('Display process identity changed')
        os.kill(pid, 15)
    elif command == 'screenshot':
        n, scale, fmt = int(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
        if n not in DISPLAYS or not .1 <= scale <= 1 or fmt not in ('png', 'jpeg'):
            raise ValueError('Invalid screenshot request')
        with tempfile.TemporaryDirectory(prefix='shot-', dir=ROOT) as folder:
            image = str(Path(folder) / 'screen.png')
            subprocess.run(['scrot', '-o', image], env=dict(os.environ, DISPLAY=f':{n}'), check=True, timeout=10)
            subprocess.run(['convert', image, '-resize', f'{scale * 100}%', f'{fmt}:-'], check=True, timeout=10)
    else:
        raise ValueError('Unknown display operation')
