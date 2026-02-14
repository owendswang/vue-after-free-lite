import { libc_addr } from 'download0/userland'
import { fn, BigInt, mem, utils } from 'download0/types'

if (typeof libc_addr === 'undefined') {
  include('userland.js')
}

export function start_ftp_server() {
  const FTP_PORT = 0
  const FTP_ROOT = '/'
  const MAX_CLIENTS = 4

  const read_sys = fn.read
  const write_sys = fn.write
  const open_sys = fn.open
  const close_sys = fn.close
  const socket_sys = fn.socket
  const bind_sys = fn.bind
  const accept_sys = fn.accept
  const setsockopt_sys = fn.setsockopt
  const getsockname_sys = fn.getsockname
  const connect_sys = fn.connect
  const stat_sys = fn.stat
  const unlink_sys = fn.unlink
  const rename_sys = fn.rename
  const mkdir_sys = fn.mkdir
  const rmdir_sys = fn.rmdir
  const getdents_sys = fn.getdents
  const ioctl_sys = fn.ioctl
  const listen_sys = fn.listen

  const AF_INET = 2
  const SOCK_STREAM = 1
  const SOL_SOCKET = 0xFFFF
  const SO_REUSEADDR = 0x4
  const FIONBIO = 0x8004667e

  const O_RDONLY = 0x0000
  const O_WRONLY = 0x0001
  const O_CREAT = 0x0200
  const O_TRUNC = 0x0400

  const S_IFMT = 0xF000
  const S_IFDIR = 0x4000
  const S_IFREG = 0x8000

  function get_local_ip() {
    try {
      const SOCK_DGRAM = 2
      const udp_fd = socket_sys(new BigInt(0, AF_INET), new BigInt(0, SOCK_DGRAM), new BigInt(0, 0))

      if (udp_fd.lt(0)) {
        return '0.0.0.0'
      }

      const remote_addr = mem.malloc(16)
      mem.view(remote_addr).setUint8(1, AF_INET)
      mem.view(remote_addr).setUint16(2, htons(53), false)
      mem.view(remote_addr).setUint32(4, 0x08080808, false)

      connect_sys(udp_fd, remote_addr, new BigInt(0, 16))

      const local_addr = mem.malloc(16)
      const addrlen = mem.malloc(4)
      mem.view(addrlen).setUint32(0, 16, true)

      const ret = getsockname_sys(udp_fd, local_addr, addrlen)

      close_sys(udp_fd)

      if (!ret || ret.eq(0) || (ret instanceof BigInt && ret.eq(new BigInt(0, 0)))) {
        const ip_addr = mem.view(local_addr).getUint32(4, false)
        const ip_bytes = [
          (ip_addr >> 24) & 0xFF,
          (ip_addr >> 16) & 0xFF,
          (ip_addr >> 8) & 0xFF,
          ip_addr & 0xFF
        ]
        return ip_bytes[0] + '.' + ip_bytes[1] + '.' + ip_bytes[2] + '.' + ip_bytes[3]
      }

      return '0.0.0.0'
    } catch (e) {
      return '0.0.0.0'
    }
  }

  function htons(port: number) {
    return ((port & 0xFF) << 8) | ((port >> 8) & 0xFF)
  }

  function new_tcp_socket() {
    const sd = socket_sys(new BigInt(0, AF_INET), new BigInt(0, SOCK_STREAM), new BigInt(0, 0))

    if (sd instanceof BigInt) {
      if (sd.eq(new BigInt(0xFFFFFFFF, 0xFFFFFFFF))) {
        throw new Error('socket() failed')
      }
      return sd.lo
    }

    if (sd === -1) {
      throw new Error('socket() failed')
    }

    return sd
  }

  function set_nonblock(fd: number) {
    const on = mem.malloc(4)
    mem.view(on).setUint32(0, 1, true)
    ioctl_sys(new BigInt(fd), new BigInt(0, FIONBIO), on)
  }

  function send_response(client_fd: BigInt, code: string, message: string) {
    const response = code + ' ' + message + '\r\n'

    const buf = mem.malloc(response.length + 1)
    for (let i = 0; i < response.length; i++) {
      mem.view(buf).setUint8(i, response.charCodeAt(i))
    }
    mem.view(buf).setUint8(response.length, 0)

    write_sys(client_fd, buf, new BigInt(0, response.length))
  }

  function read_line(client_fd: BigInt) {
    const buf = mem.malloc(1024)
    let line = ''
    let total = 0

    while (total < 1023) {
      const ret = read_sys(client_fd, buf.add(new BigInt(0, total)), new BigInt(0, 1))

      if (ret instanceof BigInt) {
        if (ret.eq(new BigInt(0, 0))) return ''
        if (ret.hi === 0xFFFFFFFF || ret.lo >= 0x80000000) return ''
      }

      const ch = mem.view(buf).getUint8(total)
      total++

      if (ch === 10) break
      if (ch !== 13) {
        line += String.fromCharCode(ch)
      }
    }

    return line
  }

  function build_path(base: string, path: string) {
    let result
    if (path.charAt(0) === '/') {
      result = FTP_ROOT + path
    } else {
      result = base + '/' + path
    }

    // Remove trailing slashes (except for root)
    while (result.length > 1 && result.charAt(result.length - 1) === '/') {
      result = result.substring(0, result.length - 1)
    }

    // Fix double slashes
    while (result.indexOf('//') !== -1) {
      result = result.replace('//', '/')
    }

    return result
  }

  function format_file_mode(mode: number) {
    let str = ''

    if ((mode & S_IFMT) === S_IFDIR) {
      str += 'd'
    } else {
      str += '-'
    }

    str += (mode & 0x100) ? 'r' : '-'
    str += (mode & 0x080) ? 'w' : '-'
    str += (mode & 0x040) ? 'x' : '-'
    str += (mode & 0x020) ? 'r' : '-'
    str += (mode & 0x010) ? 'w' : '-'
    str += (mode & 0x008) ? 'x' : '-'
    str += (mode & 0x004) ? 'r' : '-'
    str += (mode & 0x002) ? 'w' : '-'
    str += (mode & 0x001) ? 'x' : '-'

    return str
  }

  function read_u32(p: any, off: number) {
    return mem.view(p).getUint32(off, true)
  }

  function read_u64_lo(p: any, off: number) {
    const lo = read_u32(p, off)
    const hi = read_u32(p, off + 4)
    if (hi !== 0) return 0
    return lo
  }

  function stat_mode(sb: any) {
    return mem.view(sb).getUint16(8, true)
  }

  function stat_size(sb: any) {
    return read_u64_lo(sb, 48)
  }

  function stat_mtime_sec(sb: any) {
    const sec = read_u64_lo(sb, 88)
    return sec
  }

  function fmt_list_date_local(sec: number) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const d = new Date(sec * 1000)
    const mon = months[d.getMonth()]
    const day = d.getDate()
    const year = d.getFullYear()
    const dayStr = day < 10 ? ' ' + day : '' + day
    return mon + ' ' + dayStr + ' ' + year
  }

  function fmt_modify_utc(sec: number) {
    const d = new Date(sec * 1000)
    const Y = d.getUTCFullYear()
    const M = (d.getUTCMonth() + 1).toString().padStart(2, '0')
    const D = d.getUTCDate().toString().padStart(2, '0')
    const h = d.getUTCHours().toString().padStart(2, '0')
    const m = d.getUTCMinutes().toString().padStart(2, '0')
    const s = d.getUTCSeconds().toString().padStart(2, '0')
    return '' + Y + M + D + h + m + s
  }

  function create_pasv_socket() {
    const data_fd = new_tcp_socket()

    const enable = mem.malloc(4)
    mem.view(enable).setUint32(0, 1, true)
    setsockopt_sys(new BigInt(data_fd), new BigInt(0, SOL_SOCKET), new BigInt(0, SO_REUSEADDR), enable, new BigInt(0, 4))

    const data_addr = mem.malloc(16)
    mem.view(data_addr).setUint8(1, AF_INET)
    mem.view(data_addr).setUint16(2, 0, false)
    mem.view(data_addr).setUint32(4, 0, false)

    let ret = bind_sys(new BigInt(data_fd), data_addr, new BigInt(0, 16))
    if (ret instanceof BigInt && ret.lo !== 0 && ret.hi !== 0xFFFFFFFF) {
      close_sys(new BigInt(data_fd))
      return null
    }

    ret = listen_sys(new BigInt(data_fd), new BigInt(0, 1))
    if (ret instanceof BigInt && ret.lo !== 0 && ret.hi !== 0xFFFFFFFF) {
      close_sys(new BigInt(data_fd))
      return null
    }

    const actual_addr = mem.malloc(16)
    const addrlen = mem.malloc(4)
    mem.view(addrlen).setUint32(0, 16, true)

    ret = getsockname_sys(new BigInt(data_fd), actual_addr, addrlen)
    if (ret instanceof BigInt && ret.lo !== 0 && ret.hi !== 0xFFFFFFFF) {
      close_sys(new BigInt(data_fd))
      return null
    }

    const actual_port = mem.view(actual_addr).getUint16(2, false)

    return { fd: data_fd, port: actual_port }
  }

  function accept_data_connection(pasv_fd: number) {
    log('[FTP] accept_data_connection: waiting on pasv_fd=' + pasv_fd)
    const client_ret = accept_sys(new BigInt(pasv_fd), new BigInt(0, 0), new BigInt(0, 0))
    log('[FTP] accept_sys returned: ' + (client_ret instanceof BigInt ? client_ret.toString() : client_ret))

    // Check for error: -1 as BigInt is 0xFFFFFFFF:0xFFFFFFFF
    let client_fd: number
    if (client_ret instanceof BigInt) {
      if (client_ret.hi === 0xFFFFFFFF || client_ret.lo >= 0x80000000) {
        log('[FTP] accept_data_connection: FAILED (BigInt error)')
        return -1
      }
      client_fd = client_ret.lo
    } else {
      client_fd = client_ret
      if (client_fd < 0) {
        log('[FTP] accept_data_connection: FAILED, fd=' + client_fd)
        return -1
      }
    }

    log('[FTP] accept_data_connection: SUCCESS, data_fd=' + client_fd)
    return client_fd
  }

  type State = {
    cwd: string,
    type: string,
    pasv_fd: number,
    pasv_port: number,
    rename_from: string | null
  }

  function handle_user(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '331', 'Username OK, any password accepted')
  }

  function handle_pass(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '230', 'Login successful')
  }

  function handle_syst(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '215', 'UNIX Type: L8')
  }

  function handle_pwd(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '257', '"' + state.cwd + '" is current directory')
  }

  function handle_cwd(client_fd: BigInt, args: string, state: State) {
    if (!args || args === '') {
      send_response(client_fd, '500', 'Syntax error, command unrecognized')
      return
    }

    if (args === '/') {
      state.cwd = '/'
      send_response(client_fd, '250', 'Requested file action okay, completed')
      return
    }

    if (args === '..') {
      if (state.cwd === '/') {
        send_response(client_fd, '250', 'Requested file action okay, completed')
      } else {
        const last_slash = state.cwd.lastIndexOf('/')
        if (last_slash === 0) {
          state.cwd = '/'
        } else {
          state.cwd = state.cwd.substring(0, last_slash)
        }
        send_response(client_fd, '250', 'Requested file action okay, completed')
      }
      return
    }

    let new_path
    if (args.charAt(0) === '/') {
      new_path = args
    } else {
      if (state.cwd === '/') {
        new_path = '/' + args
      } else {
        new_path = state.cwd + '/' + args
      }
    }

    // Check if path exists and is a directory using stat
    const statbuf = mem.malloc(512)
    const stat_ret = stat_sys(new_path, statbuf)

    log('[FTP] CWD: stat returned ' + (stat_ret instanceof BigInt ? stat_ret.toString() : stat_ret))

    // Check stat return - 0 means success
    let stat_ok = false
    if (stat_ret instanceof BigInt) {
      stat_ok = stat_ret.eq(new BigInt(0, 0))
    } else {
      stat_ok = (stat_ret === 0)
    }

    if (!stat_ok) {
      // Path doesn't exist
      log('[FTP] CWD: stat failed, path not found')
      send_response(client_fd, '550', 'Directory not found')
      return
    }

    // st_mode is at offset 8 on PS4 (verified from debug output)
    const mode = mem.view(statbuf).getUint16(8, true)
    log('[FTP] CWD: mode=' + mode.toString(16) + ' (mode & S_IFMT)=' + (mode & S_IFMT).toString(16))

    if ((mode & S_IFMT) !== S_IFDIR) {
      // It's a file, not a directory
      log('[FTP] CWD: not a directory')
      send_response(client_fd, '550', 'Not a directory')
      return
    }

    state.cwd = new_path
    log('[FTP] CWD: success, new cwd=' + new_path)
    send_response(client_fd, '250', 'Directory changed')
  }

  function handle_cdup(client_fd: BigInt, args: string, state: State) {
    handle_cwd(client_fd, '..', state)
  }

  function handle_type(client_fd: BigInt, args: string, state: State) {
    state.type = args.toUpperCase()
    send_response(client_fd, '200', 'Type set to ' + state.type)
  }

  function handle_pasv(client_fd: BigInt, args: string, state: State) {
    log('[FTP] PASV: creating passive socket')
    const pasv = create_pasv_socket()
    if (!pasv) {
      log('[FTP] PASV: failed to create passive socket')
      send_response(client_fd, '425', 'Cannot open passive connection')
      return
    }

    log('[FTP] PASV: created socket fd=' + pasv.fd + ', port=' + pasv.port)
    state.pasv_fd = pasv.fd
    state.pasv_port = pasv.port

    const local_addr = mem.malloc(16)
    const addrlen = mem.malloc(4)
    mem.view(addrlen).setUint32(0, 16, true)

    const ret = getsockname_sys(new BigInt(client_fd), local_addr, addrlen)

    let ip_bytes = [0, 0, 0, 0]
    if (!ret || (ret instanceof BigInt && ret.eq(new BigInt(0, 0)))) {
      const ip_addr = mem.view(local_addr).getUint32(4, false)
      ip_bytes[0] = (ip_addr >> 24) & 0xFF
      ip_bytes[1] = (ip_addr >> 16) & 0xFF
      ip_bytes[2] = (ip_addr >> 8) & 0xFF
      ip_bytes[3] = ip_addr & 0xFF
    } else {
      ip_bytes = [127, 0, 0, 1]
    }

    const p1 = (pasv.port >> 8) & 0xFF
    const p2 = pasv.port & 0xFF

    send_response(client_fd, '227', 'Entering Passive Mode (' + ip_bytes[0] + ',' + ip_bytes[1] + ',' + ip_bytes[2] + ',' + ip_bytes[3] + ',' + p1 + ',' + p2 + ')')
  }

  function handle_list(client_fd: BigInt, args: string, state: State) {
    log('[FTP] LIST: args=' + args + ', pasv_fd=' + state.pasv_fd)
    if (!state.pasv_fd || state.pasv_fd < 0) {
      send_response(client_fd, '425', 'Use PASV first')
      return
    }

    const path = state.cwd === '/' ? '/' : state.cwd
    log('[FTP] LIST: path=' + path)

    send_response(client_fd, '150', 'Opening ASCII mode data connection for file list')

    const data_fd = accept_data_connection(state.pasv_fd)
    if (data_fd < 0) {
      log('[FTP] LIST: data connection failed')
      send_response(client_fd, '426', 'Connection closed; transfer aborted')
      close_sys(new BigInt(state.pasv_fd))
      state.pasv_fd = -1
      return
    }
    log('[FTP] LIST: data connection established, fd=' + data_fd)

    const dirRet = open_sys(path, O_RDONLY, 0)
    log('[FTP] LIST: fn.open returned ' + (dirRet instanceof BigInt ? dirRet.toString() : dirRet))

    // Check for error: -1 as BigInt is 0xFFFFFFFF:0xFFFFFFFF
    let open_ok = true
    let dir_fd: number = 0
    if (dirRet instanceof BigInt) {
      if (dirRet.hi === 0xFFFFFFFF || dirRet.lo >= 0x80000000) {
        open_ok = false
        log('[FTP] LIST: fn.open failed (BigInt error)')
      } else {
        dir_fd = dirRet.lo
      }
    } else if (dirRet < 0) {
      open_ok = false
    }

    if (open_ok && dir_fd >= 0) {
      const dirent_buf = mem.malloc(1024)

      while (true) {
        const ret = getdents_sys(dir_fd, dirent_buf, new BigInt(0, 1024))

        // Check for error: -1 as BigInt is 0xFFFFFFFF:0xFFFFFFFF
        let bytes_read = 0
        if (ret instanceof BigInt) {
          if (ret.hi === 0xFFFFFFFF || ret.lo >= 0x80000000) {
            log('[FTP] LIST: getdents error (BigInt negative)')
            break
          }
          bytes_read = ret.lo
        } else {
          bytes_read = ret
        }

        if (bytes_read <= 0) break

        let offset = 0
        while (offset < bytes_read) {
          const d_reclen = mem.view(dirent_buf).getUint16(offset + 4, true)
          const d_type = mem.view(dirent_buf).getUint8(offset + 6)
          const d_namlen = mem.view(dirent_buf).getUint8(offset + 7)

          let name = ''
          for (let i = 0; i < d_namlen; i++) {
            name += String.fromCharCode(mem.view(dirent_buf).getUint8(offset + 8 + i))
          }

          if (name !== '.' && name !== '..') {
            const full = (path === '/' ? '/' + name : path + '/' + name)
            const sb = mem.malloc(512)
            const sret = stat_sys(full, sb)

            let ok = false
            if (sret instanceof BigInt) ok = sret.eq(new BigInt(0, 0))
            else ok = (sret === 0)

            let mode = S_IFREG | 0o644
            let sizeStr = '0'
            let dateStr = 'Jan  1 1970'

            if (ok) {
              mode = stat_mode(sb)
              const sz = stat_size(sb)
              sizeStr = '' + sz
              const mt = stat_mtime_sec(sb)
              if (mt) dateStr = fmt_list_date_local(mt)
            }

            const line = format_file_mode(mode) + ' 1 root root ' + sizeStr + ' ' + dateStr + ' ' + name + '\r\n'
            const line_buf = mem.malloc(line.length)
            for (let j = 0; j < line.length; j++) mem.view(line_buf).setUint8(j, line.charCodeAt(j))
            write_sys(new BigInt(data_fd), line_buf, new BigInt(0, line.length))
          }

          offset += d_reclen
        }
      }

      close_sys(new BigInt(dir_fd))
    }

    close_sys(new BigInt(data_fd))
    close_sys(new BigInt(state.pasv_fd))
    state.pasv_fd = -1

    send_response(client_fd, '226', 'Transfer complete')
  }

  function handle_retr(client_fd: BigInt, args: string, state: State) {
    log('[FTP] RETR: args=' + args + ', pasv_fd=' + state.pasv_fd)
    if (!state.pasv_fd || state.pasv_fd < 0) {
      send_response(client_fd, '425', 'Use PASV first')
      return
    }

    const path = build_path(state.cwd, args)
    log('[FTP] RETR: path=' + path)

    const fileRet = open_sys(path, O_RDONLY, 0)
    log('[FTP] RETR: fn.open returned ' + (fileRet instanceof BigInt ? fileRet.toString() : fileRet))

    // Check for error: -1 as BigInt is 0xFFFFFFFF:0xFFFFFFFF
    let open_failed = false
    let file_fd: number = 0
    if (fileRet instanceof BigInt) {
      if (fileRet.hi === 0xFFFFFFFF || fileRet.lo >= 0x80000000) {
        open_failed = true
        log('[FTP] RETR: fn.open failed (BigInt error)')
      } else {
        file_fd = fileRet.lo
      }
    } else if (fileRet < 0) {
      open_failed = true
    }

    if (open_failed || file_fd < 0) {
      log('[FTP] RETR: file not found, fd=' + file_fd)
      send_response(client_fd, '550', 'File not found')
      close_sys(new BigInt(state.pasv_fd))
      state.pasv_fd = -1
      return
    }

    log('[FTP] RETR: file opened, fd=' + file_fd)
    send_response(client_fd, '150', 'Opening BINARY mode data connection')

    const data_fd = accept_data_connection(state.pasv_fd)
    if (data_fd < 0) {
      log('[FTP] RETR: data connection failed')
      send_response(client_fd, '426', 'Connection closed; transfer aborted')
      close_sys(new BigInt(file_fd))
      close_sys(new BigInt(state.pasv_fd))
      state.pasv_fd = -1
      return
    }

    const chunk_size = 8192
    const buf = mem.malloc(chunk_size)
    let total_bytes = 0

    log('[FTP] RETR: starting transfer loop')
    while (true) {
      const ret = read_sys(new BigInt(file_fd), buf, new BigInt(0, chunk_size))

      // Check for error or EOF: -1 as BigInt is 0xFFFFFFFF:0xFFFFFFFF
      let bytes_read = 0
      if (ret instanceof BigInt) {
        if (ret.hi === 0xFFFFFFFF || ret.lo >= 0x80000000) {
          log('[FTP] RETR: fn.read error (BigInt negative)')
          break
        }
        bytes_read = ret.lo
      } else {
        bytes_read = ret
      }

      if (bytes_read <= 0) {
        log('[FTP] RETR: read returned ' + bytes_read + ', ending loop')
        break
      }

      total_bytes += bytes_read
      const write_ret = write_sys(new BigInt(data_fd), buf, new BigInt(0, bytes_read))
      log('[FTP] RETR: read ' + bytes_read + ' bytes, write returned ' + (write_ret instanceof BigInt ? write_ret.toString() : write_ret))
    }

    log('[FTP] RETR: transfer done, total=' + total_bytes + ' bytes')
    close_sys(new BigInt(file_fd))
    close_sys(new BigInt(data_fd))
    close_sys(new BigInt(state.pasv_fd))
    state.pasv_fd = -1

    send_response(client_fd, '226', 'Transfer complete')
  }

  function handle_stor(client_fd: BigInt, args: string, state: State) {
    log('[FTP] STOR: args=' + args + ', pasv_fd=' + state.pasv_fd)
    if (!state.pasv_fd || state.pasv_fd < 0) {
      send_response(client_fd, '425', 'Use PASV first')
      return
    }

    // Validate filename - reject empty or directory-like paths
    if (!args || args === '' || args === '.' || args === '..') {
      log('[FTP] STOR: invalid filename')
      send_response(client_fd, '553', 'Invalid filename')
      close_sys(new BigInt(state.pasv_fd))
      state.pasv_fd = -1
      return
    }

    const path = build_path(state.cwd, args)
    log('[FTP] STOR: path=' + path)

    // Check if path already exists as a directory
    const statbuf = mem.malloc(512)
    const stat_ret = stat_sys(path, statbuf)
    if (stat_ret instanceof BigInt && stat_ret.eq(new BigInt(0, 0))) {
      const mode = mem.view(statbuf).getUint16(8, true)
      if ((mode & S_IFMT) === S_IFDIR) {
        log('[FTP] STOR: path is a directory, refusing')
        send_response(client_fd, '550', 'Cannot overwrite directory')
        close_sys(new BigInt(state.pasv_fd))
        state.pasv_fd = -1
        return
      }
      // File exists - delete it first to avoid overwrite issues
      log('[FTP] STOR: file exists, deleting first')
      const unlink_ret = unlink_sys(path)
      log('[FTP] STOR: unlink returned ' + (unlink_ret instanceof BigInt ? unlink_ret.toString() : unlink_ret))
    }

    log('[FTP] STOR: calling fn.open with flags=' + (O_WRONLY | O_CREAT) + ', mode=0o666')
    const fileRet = open_sys(path, O_WRONLY | O_CREAT | O_TRUNC, 0o666)
    log('[FTP] STOR: fn.open returned ' + (fileRet instanceof BigInt ? fileRet.toString() : fileRet))

    // Check for error: -1 as BigInt is 0xFFFFFFFF:0xFFFFFFFF
    let open_failed = false
    let file_fd: number = 0
    if (fileRet instanceof BigInt) {
      if (fileRet.hi === 0xFFFFFFFF || fileRet.lo >= 0x80000000) {
        open_failed = true
        log('[FTP] STOR: fn.open failed (BigInt error)')
      } else {
        file_fd = fileRet.lo
      }
    } else if (fileRet < 0) {
      open_failed = true
    }

    if (open_failed || file_fd < 0) {
      log('[FTP] STOR: cannot create file, fd=' + file_fd)
      send_response(client_fd, '550', 'Cannot create file')
      close_sys(new BigInt(state.pasv_fd))
      state.pasv_fd = -1
      return
    }

    log('[FTP] STOR: file created, fd=' + file_fd)
    send_response(client_fd, '150', 'Opening BINARY mode data connection')

    const data_fd = accept_data_connection(state.pasv_fd)
    if (data_fd < 0) {
      log('[FTP] STOR: data connection failed')
      send_response(client_fd, '426', 'Connection closed; transfer aborted')
      close_sys(new BigInt(file_fd))
      close_sys(new BigInt(state.pasv_fd))
      state.pasv_fd = -1
      return
    }

    const chunk_size = 8192
    const buf = mem.malloc(chunk_size)
    let total_bytes = 0

    log('[FTP] STOR: starting transfer loop, data_fd=' + data_fd + ', file_fd=' + file_fd)
    let loop_count = 0
    while (true) {
      loop_count++
      log('[FTP] STOR: loop ' + loop_count + ' - calling read_sys...')
      const ret = read_sys(new BigInt(data_fd), buf, new BigInt(0, chunk_size))
      log('[FTP] STOR: loop ' + loop_count + ' - read_sys returned: ' + (ret instanceof BigInt ? ret.toString() : ret))

      // Check for error or EOF: -1 as BigInt is 0xFFFFFFFF:0xFFFFFFFF, 0 means EOF
      let bytes_read = 0
      if (ret instanceof BigInt) {
        if (ret.hi === 0xFFFFFFFF || ret.lo >= 0x80000000) {
          log('[FTP] STOR: read_sys error (BigInt negative)')
          break
        }
        bytes_read = ret.lo
      } else {
        bytes_read = ret
      }

      if (bytes_read <= 0) {
        log('[FTP] STOR: read returned ' + bytes_read + ', ending loop (EOF or error)')
        break
      }

      log('[FTP] STOR: loop ' + loop_count + ' - calling fn.write with ' + bytes_read + ' bytes...')
      total_bytes += bytes_read
      const write_ret = write_sys(new BigInt(file_fd), buf, new BigInt(0, bytes_read))
      log('[FTP] STOR: loop ' + loop_count + ' - fn.write returned ' + (write_ret instanceof BigInt ? write_ret.toString() : write_ret))
    }

    log('[FTP] STOR: transfer done, total=' + total_bytes + ' bytes')
    close_sys(new BigInt(file_fd))
    close_sys(new BigInt(data_fd))
    close_sys(new BigInt(state.pasv_fd))
    state.pasv_fd = -1

    send_response(client_fd, '226', 'Transfer complete')
  }

  function handle_dele(client_fd: BigInt, args: string, state: State) {
    const path = build_path(state.cwd, args)

    const ret = unlink_sys(path)
    if (ret instanceof BigInt && ret.eq(new BigInt(0, 0))) {
      send_response(client_fd, '250', 'File deleted')
    } else {
      send_response(client_fd, '550', 'Delete failed')
    }
  }

  function handle_mkd(client_fd: BigInt, args: string, state: State) {
    const path = build_path(state.cwd, args)

    const ret = mkdir_sys(path, 0x1FF)
    if (ret instanceof BigInt && ret.eq(new BigInt(0, 0))) {
      send_response(client_fd, '257', '"' + path + '" directory created')
    } else {
      send_response(client_fd, '550', 'Create directory failed')
    }
  }

  function handle_rmd(client_fd: BigInt, args: string, state: State) {
    const path = build_path(state.cwd, args)

    const ret = rmdir_sys(path)
    if (ret instanceof BigInt && ret.eq(new BigInt(0, 0))) {
      send_response(client_fd, '250', 'Directory removed')
    } else {
      send_response(client_fd, '550', 'Remove directory failed')
    }
  }

  function handle_rnfr(client_fd: BigInt, args: string, state: State) {
    state.rename_from = build_path(state.cwd, args)
    send_response(client_fd, '350', 'Ready for RNTO')
  }

  function handle_rnto(client_fd: BigInt, args: string, state: State) {
    if (!state.rename_from) {
      send_response(client_fd, '503', 'Bad sequence of commands')
      return
    }

    const path_to = build_path(state.cwd, args)

    const ret = rename_sys(state.rename_from, path_to)
    if (ret instanceof BigInt && ret.eq(new BigInt(0, 0))) {
      send_response(client_fd, '250', 'Rename successful')
    } else {
      send_response(client_fd, '550', 'Rename failed')
    }

    state.rename_from = null
  }

  function handle_size(client_fd: BigInt, args: string, state: State) {
    const path = build_path(state.cwd, args)

    const statbuf = mem.malloc(512)
    const ret = stat_sys(path, statbuf)

    if (ret instanceof BigInt && ret.eq(new BigInt(0, 0))) {
      const size = stat_size(statbuf)
      send_response(client_fd, '213', '' + size)
    } else {
      send_response(client_fd, '550', 'Could not get file size')
    }
  }

  function handle_quit(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '221', 'Goodbye')
  }

  function handle_noop(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '200', 'OK')
  }

  function handle_feat(client_fd: BigInt, args: string, state: State) {
    // Send feature list - minimal set
    const response = '211-Features:\r\n PASV\r\n SIZE\r\n MDTM\r\n MLSD\r\n UTF8\r\n211 End\r\n'
    const buf = mem.malloc(response.length + 1)
    for (let i = 0; i < response.length; i++) {
      mem.view(buf).setUint8(i, response.charCodeAt(i))
    }
    write_sys(client_fd, buf, new BigInt(0, response.length))
  }

  function handle_mdtm(client_fd: BigInt, args: string, state: State) {
    // Return a fake modification time - just indicates file exists
    const path = build_path(state.cwd, args)

    const statbuf = mem.malloc(512)
    const ret = stat_sys(path, statbuf)

    if (ret instanceof BigInt && ret.eq(new BigInt(0, 0))) {
      const mt = stat_mtime_sec(statbuf)
      if (!mt) {
        send_response(client_fd, '213', '19700101000000')
        return
      }
      send_response(client_fd, '213', fmt_modify_utc(mt))
    } else {
      send_response(client_fd, '550', 'File not found')
    }
  }

  function handle_opts(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '200', 'OK')
  }

  function handle_rest(client_fd: BigInt, args: string, state: State) {
    send_response(client_fd, '350', 'Restarting at ' + (args || '0'))
  }

  function handle_site(client_fd: BigInt, args: string, state: State) {
    const sub = (args || '').split(' ')[0].toUpperCase()
    if (sub === 'UTIME' || sub === 'CHMOD') {
      send_response(client_fd, '200', 'OK')
      return
    }
    send_response(client_fd, '502', 'Command not implemented')
  }

  function handle_mlsd(client_fd: BigInt, args: string, state: State) {
    if (!state.pasv_fd || state.pasv_fd < 0) {
      send_response(client_fd, '425', 'Use PASV first')
      return
    }

    const path = state.cwd === '/' ? '/' : state.cwd
    send_response(client_fd, '150', 'Opening BINARY mode data connection for MLSD')

    const data_fd = accept_data_connection(state.pasv_fd)
    if (data_fd < 0) {
      send_response(client_fd, '426', 'Connection closed; transfer aborted')
      close_sys(new BigInt(state.pasv_fd))
      state.pasv_fd = -1
      return
    }

    const dirRet = open_sys(path, O_RDONLY, 0)

    let open_ok = true
    let dir_fd: number = 0
    if (dirRet instanceof BigInt) {
      if (dirRet.hi === 0xFFFFFFFF || dirRet.lo >= 0x80000000) open_ok = false
      else dir_fd = dirRet.lo
    } else if (dirRet < 0) {
      open_ok = false
    }

    if (open_ok && dir_fd >= 0) {
      const dirent_buf = mem.malloc(1024)

      while (true) {
        const ret = getdents_sys(dir_fd, dirent_buf, new BigInt(0, 1024))
        let bytes_read = 0
        if (ret instanceof BigInt) {
          if (ret.hi === 0xFFFFFFFF || ret.lo >= 0x80000000) break
          bytes_read = ret.lo
        } else {
          bytes_read = ret
        }
        if (bytes_read <= 0) break

        let offset = 0
        while (offset < bytes_read) {
          const d_reclen = mem.view(dirent_buf).getUint16(offset + 4, true)
          const d_type = mem.view(dirent_buf).getUint8(offset + 6)
          const d_namlen = mem.view(dirent_buf).getUint8(offset + 7)

          let name = ''
          for (let i = 0; i < d_namlen; i++) {
            name += String.fromCharCode(mem.view(dirent_buf).getUint8(offset + 8 + i))
          }

          if (name !== '.' && name !== '..') {
            const full = (path === '/' ? '/' + name : path + '/' + name)
            const sb = mem.malloc(512)
            const sret = stat_sys(full, sb)

            let ok = false
            if (sret instanceof BigInt) ok = sret.eq(new BigInt(0, 0))
            else ok = (sret === 0)

            let typeStr = (d_type === 4 ? 'dir' : 'file')
            let sizeStr = '0'
            let modifyStr = '19700101000000'

            if (ok) {
              const mode = stat_mode(sb)
              typeStr = ((mode & S_IFMT) === S_IFDIR) ? 'dir' : 'file'
              sizeStr = '' + stat_size(sb)
              const mt = stat_mtime_sec(sb)
              if (mt) modifyStr = fmt_modify_utc(mt)
            }

            const line = 'type=' + typeStr + ';size=' + sizeStr + ';modify=' + modifyStr + '; ' + name + '\r\n'
            const line_buf = mem.malloc(line.length)
            for (let j = 0; j < line.length; j++) mem.view(line_buf).setUint8(j, line.charCodeAt(j))
            write_sys(new BigInt(data_fd), line_buf, new BigInt(0, line.length))
          }

          offset += d_reclen
        }
      }

      close_sys(new BigInt(dir_fd))
    }

    close_sys(new BigInt(data_fd))
    close_sys(new BigInt(state.pasv_fd))
    state.pasv_fd = -1

    send_response(client_fd, '226', 'Transfer complete')
  }

  function handle_client(client_fd: BigInt, client_num: number) {
    set_nonblock(client_fd.lo)

    const state: State = {
      cwd: '/',
      type: 'A',
      pasv_fd: -1,
      pasv_port: -1,
      rename_from: null
    }

    try {
      send_response(client_fd, '220', 'PS4 FTP Server Ready')

      let running = true
      while (running) {
        const line = read_line(client_fd)
        if (line.length === 0) {
          setTimeout(() => handle_client(client_fd, client_num), 16)
          return
        }

        const parts = line.split(' ')
        const cmd = parts[0]!.toUpperCase()
        const args = parts.slice(1).join(' ')

        log('[FTP] CMD: ' + cmd + ' ' + args)

        if (cmd === 'USER') {
          handle_user(client_fd, args, state)
        } else if (cmd === 'PASS') {
          handle_pass(client_fd, args, state)
        } else if (cmd === 'SYST') {
          handle_syst(client_fd, args, state)
        } else if (cmd === 'PWD') {
          handle_pwd(client_fd, args, state)
        } else if (cmd === 'CWD') {
          handle_cwd(client_fd, args, state)
        } else if (cmd === 'CDUP') {
          handle_cdup(client_fd, args, state)
        } else if (cmd === 'TYPE') {
          handle_type(client_fd, args, state)
        } else if (cmd === 'PASV') {
          handle_pasv(client_fd, args, state)
        } else if (cmd === 'LIST') {
          handle_list(client_fd, args, state)
        } else if (cmd === 'RETR') {
          handle_retr(client_fd, args, state)
        } else if (cmd === 'STOR') {
          handle_stor(client_fd, args, state)
        } else if (cmd === 'DELE') {
          handle_dele(client_fd, args, state)
        } else if (cmd === 'MKD' || cmd === 'XMKD') {
          handle_mkd(client_fd, args, state)
        } else if (cmd === 'RMD' || cmd === 'XRMD') {
          handle_rmd(client_fd, args, state)
        } else if (cmd === 'RNFR') {
          handle_rnfr(client_fd, args, state)
        } else if (cmd === 'RNTO') {
          handle_rnto(client_fd, args, state)
        } else if (cmd === 'SIZE') {
          handle_size(client_fd, args, state)
        } else if (cmd === 'NOOP') {
          handle_noop(client_fd, args, state)
        } else if (cmd === 'FEAT') {
          handle_feat(client_fd, args, state)
        } else if (cmd === 'MDTM') {
          handle_mdtm(client_fd, args, state)
        } else if (cmd === 'OPTS') {
          handle_opts(client_fd, args, state)
        } else if (cmd === 'REST') {
          handle_rest(client_fd, args, state)
        } else if (cmd === 'SITE') {
          handle_site(client_fd, args, state)
        } else if (cmd === 'MLSD') {
          handle_mlsd(client_fd, args, state)
        } else if (cmd === 'QUIT') {
          handle_quit(client_fd, args, state)
          running = false
        } else {
          send_response(client_fd, '502', 'Command not implemented')
        }
      }
    } catch (e) {
      error(e.message)
    } finally {
      if (state.pasv_fd >= 0) {
        close_sys(new BigInt(state.pasv_fd))
      }
      close_sys(client_fd)
    }
  }

  try {
    const server_fd = new_tcp_socket()

    const enable = mem.malloc(4)
    mem.view(enable).setUint32(0, 1, true)
    setsockopt_sys(new BigInt(server_fd), new BigInt(0, SOL_SOCKET), new BigInt(0, SO_REUSEADDR), enable, new BigInt(0, 4))

    const server_addr = mem.malloc(16)
    mem.view(server_addr).setUint8(1, AF_INET)
    mem.view(server_addr).setUint16(2, htons(FTP_PORT), false)
    mem.view(server_addr).setUint32(4, 0, false)

    let ret = bind_sys(new BigInt(server_fd), server_addr, new BigInt(0, 16))
    if (ret instanceof BigInt && ret.lo !== 0 && ret.hi !== 0xFFFFFFFF) {
      throw new Error('bind() failed')
    }

    const actual_addr = mem.malloc(16)
    const addrlen = mem.malloc(4)
    mem.view(addrlen).setUint32(0, 16, true)

    ret = getsockname_sys(new BigInt(server_fd), actual_addr, addrlen)
    if (ret instanceof BigInt && ret.lo !== 0 && ret.hi !== 0xFFFFFFFF) {
      throw new Error('getsockname() failed')
    }

    const actual_port = mem.view(actual_addr).getUint16(2, false)

    ret = listen_sys(new BigInt(server_fd), new BigInt(0, MAX_CLIENTS))
    if (ret instanceof BigInt && ret.lo !== 0 && ret.hi !== 0xFFFFFFFF) {
      throw new Error('listen() failed')
    }

    const ip_str = get_local_ip()

    log('[FTP] Server started: ftp://' + ip_str + ':' + actual_port)
    utils.notify('FTP Server: ftp://' + ip_str + ':' + actual_port)

    let client_num = 0
    set_nonblock(server_fd)

    function accept_tick() {
      const client_ret = accept_sys(new BigInt(server_fd), new BigInt(0, 0), new BigInt(0, 0))
      const client_fd = client_ret instanceof BigInt ? client_ret.lo : client_ret

      if (client_fd >= 0) {
        client_num++
        log('[FTP] accept client_fd=' + client_fd)
        handle_client(new BigInt(client_fd), client_num)
      }

      setTimeout(accept_tick, 16)
    }

    setTimeout(accept_tick, 0)
  } catch (e) {
    log('[FTP] Error: ' + ((e as Error).stack || (e as Error).message || e))
  }
}

// start_ftp_server()
