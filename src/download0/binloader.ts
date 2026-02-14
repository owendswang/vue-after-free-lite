import { fn, BigInt, mem, utils } from 'download0/types'
import { libc_addr } from 'download0/userland'

// bin_loader.js - ELF/binary loader for PS4 after vue-after-free jailbreak
// Ported from netflix N Hack for ps4
//
// Usage: include('binloader.js') before userland/lapse
//        After lapse completes, call: binloader_init()

// Define binloader_init function
export function binloader_init (payloadSelect: string | undefined) {
  debug('binloader_init(): Initializing binloader...')

  // Check dependencies
  if (typeof fn === 'undefined') {
    error('ERROR: fn object is undefined! userland.js not loaded?')
    throw new Error('fn object not available - cannot initialize binloader')
  }

  debug('binloader_init(): Dependencies OK, initializing...')

  const thrd_create = fn.thrd_create
  const thrd_join = fn.thrd_join
  const stat_sys = fn.stat_sys
  const open_sys = fn.open_sys
  const read_sys = fn.read_sys
  const write_sys = fn.write_sys
  const close_sys = fn.close_sys
  const mmap_sys = fn.mmap_sys
  const bind_sys = fn.bind_sys
  const listen_sys = fn.listen_sys
  const accept_sys = fn.accept_sys
  const connect_sys = fn.connect_sys
  const socket = fn.socket
  const setsockopt = fn.setsockopt
  const exit_sys = fn.exit_sys
  const nanosleep_sys = fn.nanosleep_sys
  const thr_exit_sys = fn.thr_exit_sys

  // Constants
  const BIN_LOADER_PORT = 9020
  const MAX_PAYLOAD_SIZE = 4 * 1024 * 1024  // 4MB max
  const READ_CHUNK = 32768  // 32KB chunks for faster transfer
  const PAGE_SIZE = 16384  // PS4 page size

  // ELF magic bytes
  const ELF_MAGIC = 0x464C457F  // "\x7fELF" as little-endian uint32

  // mmap constants
  const BL_MAP_PRIVATE = 0x2
  const BL_MAP_ANONYMOUS = 0x1000
  const BL_PROT_READ = 0x1
  const BL_PROT_WRITE = 0x2
  const BL_PROT_EXEC = 0x4

  // Socket constants
  const BL_AF_INET = 2
  const BL_SOCK_STREAM = 1
  const BL_SOL_SOCKET = 0xffff
  const BL_SO_REUSEADDR = 4

  // File open flags
  const BL_O_RDONLY = 0
  const BL_O_WRONLY = 1
  const BL_O_RDWR = 2
  const BL_O_CREAT = 0x200
  const BL_O_TRUNC = 0x400

  // USB and data paths (check usb0-usb4 like BD-JB does)
  const USB_PAYLOAD_PATHS = [
    '/mnt/usb0/payload.bin',
    '/mnt/usb1/payload.bin',
    '/mnt/usb2/payload.bin',
    '/mnt/usb3/payload.bin',
    '/mnt/usb4/payload.bin',
    '/mnt/usb0/payload.bin.bin',
    '/mnt/usb1/payload.bin.bin',
    '/mnt/usb2/payload.bin.bin', // yes we have to do this 😅
    '/mnt/usb3/payload.bin.bin',
    '/mnt/usb4/payload.bin.bin'
  ]
  const DATA_PAYLOAD_PATH = '/data/payload.bin'
  const SANDBOX_PAYLOAD_PATH = '/mnt/sandbox/download/CUSA00960/payload.bin'

  // S_ISREG macro check - file type is regular file
  const S_IFREG = 0x8000

  // ELF header structure offsets
  const ELF_HEADER = {
    E_ENTRY: 0x18,
    E_PHOFF: 0x20,
    E_PHENTSIZE: 0x36,
    E_PHNUM: 0x38,
  }

  // Program header structure offsets
  const PROGRAM_HEADER = {
    P_TYPE: 0x00,
    P_FLAGS: 0x04,
    P_OFFSET: 0x08,
    P_VADDR: 0x10,
    P_FILESZ: 0x20,
    P_MEMSZ: 0x28,
  }

  const PT_LOAD = 1

  // Helper: Round up to page boundary
  function bl_round_up (x: number, base: number) {
    return Math.floor((x + base - 1) / base) * base
  }

  // Helper: Check for syscall error
  function bl_is_error (val: number | BigInt) {
    if (val instanceof BigInt) {
      return val.hi === 0xffffffff
    }
    return val === -1 || val === 0xffffffff
  }

  // Helper: Allocate string in memory and return address
  function bl_alloc_string (str: string) {
    const addr = mem.malloc(str.length + 1)
    for (let i = 0; i < str.length; i++) {
      mem.view(addr).setUint8(i, str.charCodeAt(i))
    }
    mem.view(addr).setUint8(str.length, 0)  // null terminator
    return addr
  }

  // Helper: Check if file exists using stat() and return size, or -1 if not found
  function bl_file_exists (path: string) {
    debug('Checking: ' + path)
    const path_addr = bl_alloc_string(path)
    const stat_buf = mem.malloc(0x78)

    // Call stat(path, &stat_buf) - catch errors (file not found)
    try {
      const ret = stat_sys(path_addr, stat_buf)

      if (bl_is_error(ret)) {
        debug('  stat() failed - file not found')
        return -1
      }

      // Check st_mode at offset 0x08 to see if it's a regular file
      const st_mode = mem.view(stat_buf).getUint16(0x08, true)

      // Check S_ISREG (mode & 0xF000) == S_IFREG (0x8000)
      if ((st_mode & 0xF000) !== S_IFREG) {
        debug('  Not a regular file (st_mode=0x' + st_mode.toString(16) + ')')
        return -1
      }

      // st_size is at offset 0x48 in struct stat (int64_t)
      const size = mem.view(stat_buf).getBigInt(0x48, true)
      const size_num = size.lo + (size.hi * 0x100000000)
      debug('  Found: ' + size_num + ' bytes')

      return size_num
    } catch (e) {
      error('  ' + (e as Error).message)
      return -1
    }
  }

  // Get file size using stat()
  function bl_get_file_size_stat (path: string) {
    const path_addr = bl_alloc_string(path)
    const stat_buf = mem.malloc(0x78)

    try {
      const ret = stat_sys(path_addr, stat_buf)
      if (bl_is_error(ret)) {
        return -1
      }

      // st_size is at offset 0x48
      const size = mem.view(stat_buf).getBigInt(0x48, true)
      return size.lo + (size.hi * 0x100000000)
    } catch (e) {
      return -1
    }
  }

  // Read entire file into memory buffer
  function bl_read_file (path: string) {
    // Use stat() to get file size
    const size = bl_get_file_size_stat(path)
    if (size <= 0) {
      error('  stat failed or size=0')
      return null
    }

    const path_addr = bl_alloc_string(path)
    const fd = open_sys(path_addr, new BigInt(0, BL_O_RDONLY), new BigInt(0, 0))

    if (bl_is_error(fd)) {
      error('  open failed')
      return null
    }

    const fd_num = (fd instanceof BigInt) ? fd.lo : fd
    const buf = mem.malloc(size)
    let total_read = 0

    while (total_read < size) {
      const chunk = size - total_read > READ_CHUNK ? READ_CHUNK : size - total_read
      const bytes_read = read_sys(
        new BigInt(0, fd_num),
        buf.add(new BigInt(0, total_read)),
        new BigInt(0, chunk)
      )

      if (bl_is_error(bytes_read) || bytes_read.eq(0)) {
        break
      }
      total_read += bytes_read.lo
    }

    close_sys(fd_num)

    if (total_read !== size) {
      error('  read incomplete: ' + total_read + '/' + size)
      return null
    }

    return { buf, size }
  }

  // Write buffer to file
  function bl_write_file (path: string, buf: BigInt, size: number) {
    const path_addr = bl_alloc_string(path)
    const flags = BL_O_WRONLY | BL_O_CREAT | BL_O_TRUNC
    debug('  write_file: open(' + path + ', flags=0x' + flags.toString(16) + ')')

    const fd = open_sys(path_addr, new BigInt(0, flags), new BigInt(0, 0o755))
    const fd_num = (fd instanceof BigInt) ? fd.lo : fd
    debug('  write_file: fd=' + fd_num)

    if (bl_is_error(fd)) {
      error('  write_file: open failed')
      return false
    }

    let total_written = 0
    while (total_written < size) {
      const chunk = size - total_written > READ_CHUNK ? READ_CHUNK : size - total_written
      const bytes_written = write_sys(
        new BigInt(0, fd_num),
        buf.add(new BigInt(0, total_written)),
        new BigInt(0, chunk)
      )

      if (bl_is_error(bytes_written) || bytes_written.eq(0)) {
        error('  write_file: write failed at ' + total_written + '/' + size)
        close_sys(fd_num)
        return false
      }
      total_written += bytes_written.lo
    }

    close_sys(fd_num)
    debug('  write_file: wrote ' + total_written + ' bytes')
    return true
  }

  // Copy file from src to dst
  function bl_copy_file (src_path: string, dst_path: string) {
    log('Copying ' + src_path + ' -> ' + dst_path)

    const data = bl_read_file(src_path)
    if (data === null) {
      error('Failed to read source file')
      return false
    }

    log('Read ' + data.size + ' bytes')

    if (!bl_write_file(dst_path, data.buf, data.size)) {
      error('Failed to write destination file')
      return false
    }

    log('Copy complete')
    return true
  }

  // Read ELF header from buffer
  function bl_read_elf_header (buf_addr: BigInt) {
    return {
      magic: mem.view(buf_addr).getUint32(0, true),
      e_entry: mem.view(buf_addr).getBigInt(ELF_HEADER.E_ENTRY, true),
      e_phoff: mem.view(buf_addr).getBigInt(ELF_HEADER.E_PHOFF, true),
      e_phentsize: mem.view(buf_addr).getUint16(ELF_HEADER.E_PHENTSIZE, true),
      e_phnum: mem.view(buf_addr).getUint16(ELF_HEADER.E_PHNUM, true),
    }
  }

  // Read program header from buffer
  function bl_read_program_header (buf_addr: BigInt, offset: number) {
    const base = buf_addr.add(new BigInt(0, offset))
    return {
      p_type: mem.view(base).getUint32(PROGRAM_HEADER.P_TYPE, true),
      p_flags: mem.view(base).getUint32(PROGRAM_HEADER.P_FLAGS, true),
      p_offset: mem.view(base).getBigInt(PROGRAM_HEADER.P_OFFSET, true),
      p_vaddr: mem.view(base).getBigInt(PROGRAM_HEADER.P_VADDR, true),
      p_filesz: mem.view(base).getBigInt(PROGRAM_HEADER.P_FILESZ, true),
      p_memsz: mem.view(base).getBigInt(PROGRAM_HEADER.P_MEMSZ, true),
    }
  }

  // Load ELF segments into mmap'd memory
  function bl_load_elf_segments (buf_addr: BigInt, base_addr: BigInt) {
    const elf = bl_read_elf_header(buf_addr)

    debug('ELF: ' + elf.e_phnum + ' segments, entry @ ' + elf.e_entry.toString())

    for (let i = 0; i < elf.e_phnum; i++) {
      const phdr_offset = (elf.e_phoff.lo + (elf.e_phoff.hi * 0x100000000)) + i * elf.e_phentsize
      const segment = bl_read_program_header(buf_addr, phdr_offset)

      if (segment.p_type === PT_LOAD && !segment.p_memsz.eq(0)) {
        // Use lower 24 bits of vaddr to get offset within region
        const seg_offset_num = segment.p_vaddr.lo & 0xffffff
        const seg_addr = base_addr.add(new BigInt(0, seg_offset_num))

        // Copy segment data
        const filesz = segment.p_filesz.lo + (segment.p_filesz.hi * 0x100000000)
        const src_addr = buf_addr.add(segment.p_offset)

        // Copy using mem API
        for (let j = 0; j < filesz; j++) {
          const byte = mem.view(src_addr).getUint8(j)
          mem.view(seg_addr).setUint8(j, byte)
        }

        // Zero remaining memory (memsz - filesz)
        const memsz = segment.p_memsz.lo + (segment.p_memsz.hi * 0x100000000)
        if (memsz > filesz) {
          for (let j = filesz; j < memsz; j++) {
            mem.view(seg_addr).setUint8(j, 0)
          }
        }
      }
    }

    // Return entry point address
    const entry_offset = elf.e_entry.lo & 0xffffff
    return base_addr.add(new BigInt(0, entry_offset))
  }

  function bl_sleep_ms(ms: number) {
    const ts = mem.malloc(16)
    mem.view(ts).setBigInt(0, new BigInt(0, Math.floor(ms / 1000)), true)
    mem.view(ts).setBigInt(8, new BigInt(0, (ms % 1000) * 1000000), true)
    nanosleep_sys(ts, new BigInt(0, 0))
  }

  // BinLoader object
  const BinLoader: {
    data: BigInt | null,
    data_size: number,
    mmap_base: BigInt | null,
    mmap_size: number,
    entry_point: BigInt | null,
    skip_autoclose: boolean,
    init: (bin_data_addr: BigInt, bin_size: number) => void,
    run: () => void
  } = {
    data: null,
    data_size: 0,
    mmap_base: null,
    mmap_size: 0,
    entry_point: null,
    skip_autoclose: false,
    init: function (bin_data_addr, bin_size) {
      this.data = bin_data_addr
      this.data_size = bin_size

      // Calculate mmap size (round up to page boundary)
      this.mmap_size = bl_round_up(bin_size, PAGE_SIZE)

      // Allocate RWX memory using mmap
      const prot = new BigInt(0, BL_PROT_READ | BL_PROT_WRITE | BL_PROT_EXEC)
      const flags = new BigInt(0, BL_MAP_PRIVATE | BL_MAP_ANONYMOUS)

      const ret = mmap_sys(
        new BigInt(0, 0),
        new BigInt(0, this.mmap_size),
        prot,
        flags,
        new BigInt(0xffffffff, 0xffffffff),  // fd = -1
        new BigInt(0, 0)
      )

      if (bl_is_error(ret)) {
        throw new Error('mmap failed: ' + ret.toString())
      }

      this.mmap_base = ret
      debug('mmap() allocated at: ' + this.mmap_base.toString())

      // Check for ELF magic
      const magic = mem.view(bin_data_addr).getUint32(0, true)

      if (magic === ELF_MAGIC) {
        debug('Detected ELF binary, parsing headers...')
        this.entry_point = bl_load_elf_segments(bin_data_addr, this.mmap_base)
      } else {
        debug('Non-ELF binary, treating as raw shellcode (' + bin_size + ' bytes)')
        // Copy raw binary
        for (let i = 0; i < bin_size; i++) {
          const byte = mem.view(bin_data_addr).getUint8(i)
          mem.view(this.mmap_base).setUint8(i, byte)
        }
        this.entry_point = this.mmap_base
      }

      debug('Entry point: ' + this.entry_point.toString())
    },
    run: function () {
      if (this.entry_point === null) {
        throw new Error('BinLoader not initialized properly - no entry point')
      }

      debug('Spawning payload thread using thrd_create...')

      // Allocate thread handle and result storage
      const thread_handle = mem.malloc(8)  // thrd_t handle
      const thread_result = mem.malloc(4)  // int result

      // Initialize to 0
      mem.view(thread_handle).setBigInt(0, new BigInt(0, 0), true)
      mem.view(thread_result).setUint32(0, 0, true)

      debug('Entry point @ ' + this.entry_point.toString())

      // Call thrd_create(thread_handle, entry_point, NULL)
      // int thrd_create(thrd_t *thr, thrd_start_t func, void *arg);
      debug('Calling thrd_create...')
      const ret = thrd_create(
        thread_handle,           // thrd_t *thr
        this.entry_point,   // thrd_start_t func
        new BigInt(0, 0)         // void *arg (NULL)
      )

      // thrd_success = 0
      if (ret.eq(0)) {
        log('SUCCESS: Payload thread created!')
        const thr_id = mem.view(thread_handle).getBigInt(0, true)
        debug('Thread handle: ' + thr_id.toString())
        // utils.notify("Payload loaded!\nThread spawned successfully");

        // Call thrd_join to wait for thread completion
        // int thrd_join(thrd_t thr, int *res);
        debug('Waiting for thread to complete (thrd_join)...')
        const join_ret = thrd_join(
          thr_id,              // thrd_t thr
          thread_result        // int *res
        )

        if (join_ret.eq(0)) {
          const result_val = mem.view(thread_result).getUint32(0, true)
          debug('Thread completed successfully with result: ' + result_val)
        } else {
          log('WARNING: thrd_join returned: ' + join_ret.toString())
        }

        log('Binloader complete - thread has finished')

        // Check if autoclose is enabled
        if (!BinLoader.skip_autoclose) {
          log('Auto closing - terminating current process')

          bl_sleep_ms(500)
          const pid = fn.getpid()
          const pid_num = pid.lo
          const kr = fn.kill(pid_num, 9)
          log('kill ret=' + kr.toString())
          // exit_sys(0)
          return
        }
      } else {
        error('ERROR: thrd_create failed with return value: ' + ret.toString())
        throw new Error('Failed to spawn payload thread')
      }
    }
  }

  // Create listening socket
  function bl_create_listen_socket (port: number) {
    const sd = socket(BL_AF_INET, BL_SOCK_STREAM, 0)
    const sd_num = (sd instanceof BigInt) ? sd.lo : sd

    if (bl_is_error(sd)) {
      throw new Error('socket() failed')
    }

    // Set SO_REUSEADDR
    const enable = mem.malloc(4)
    mem.view(enable).setUint32(0, 1, true)
    setsockopt(sd_num, BL_SOL_SOCKET, BL_SO_REUSEADDR, enable, 4)

    // Build sockaddr_in
    const sockaddr = mem.malloc(16)
    for (let j = 0; j < 16; j++) {
      mem.view(sockaddr).setUint8(j, 0)
    }
    mem.view(sockaddr).setUint8(1, 2)  // AF_INET
    mem.view(sockaddr).setUint8(2, (port >> 8) & 0xff)  // port high byte
    mem.view(sockaddr).setUint8(3, port & 0xff)         // port low byte
    mem.view(sockaddr).setUint32(4, 0, true)  // INADDR_ANY

    let ret = bind_sys(new BigInt(0, sd_num), sockaddr, new BigInt(0, 16))
    if (bl_is_error(ret)) {
      close_sys(sd_num)
      throw new Error('bind() failed')
    }

    ret = listen_sys(new BigInt(0, sd_num), new BigInt(0, 1))
    if (bl_is_error(ret)) {
      close_sys(sd_num)
      throw new Error('listen() failed')
    }

    return sd_num
  }

  // Read payload data from client socket
  function bl_read_payload_from_socket (client_sock: number, max_size: number) {
    const payload_buf = mem.malloc(max_size)
    let total_read = 0

    while (total_read < max_size) {
      const remaining = max_size - total_read
      const chunk_size = remaining < READ_CHUNK ? remaining : READ_CHUNK

      const read_size = read_sys(
        new BigInt(0, client_sock),
        payload_buf.add(new BigInt(0, total_read)),
        new BigInt(0, chunk_size)
      )

      if (bl_is_error(read_size)) {
        throw new Error('read() failed')
      }

      if (read_size.eq(0)) {
        break  // EOF
      }

      total_read += read_size.lo

      // Progress update every 128KB
      if (total_read % (128 * 1024) === 0) {
        log('Received ' + (total_read / 1024) + ' KB...')
      }
    }

    return { buf: payload_buf, size: total_read }
  }

  // Load and run payload from file
  function bl_load_from_file (path: string, skip_autoclose: boolean = true) {
    log('Loading payload from: ' + path)

    const payload = bl_read_file(path)
    if (payload === null) {
      error('Failed to read payload file')
      return false
    }

    log('Read ' + payload.size + ' bytes')

    if (payload.size < 64) {
      error('ERROR: Payload too small')
      return false
    }

    BinLoader.skip_autoclose = skip_autoclose

    try {
      BinLoader.init(payload.buf, payload.size)
      if (!skip_autoclose) {
        log("Running payload in 1 second. Then auto close...")
        jsmaf.setTimeout(function() {
          BinLoader.run()
          log('Payload loaded successfully')
        }, 1000)
      } else {
        BinLoader.run()
        log('Payload loaded successfully')
      }
    } catch (e) {
      error('ERROR loading payload: ' + (e as Error).message)
      if ((e as Error).stack) log((e as Error).stack ?? '')
      return false
    }

    return true
  }

  // Network binloader (fallback)
  function bl_network_loader () {
    log('Starting network payload server...')

    let server_sock
    try {
      server_sock = bl_create_listen_socket(BIN_LOADER_PORT)
    } catch (e) {
      error('ERROR: ' + (e as Error).message)
      utils.notify('Bin loader failed!\n' + (e as Error).message)
      return false
    }

    const network_str = '<PS4 IP>:' + BIN_LOADER_PORT

    log('Listening on ' + network_str)
    log('Send your ELF payload to this address')
    utils.notify('Binloader listening on:\n' + network_str)

    // Accept client connection
    const sockaddr = mem.malloc(16)
    const sockaddr_len = mem.malloc(4)
    mem.view(sockaddr_len).setUint32(0, 16, true)

    const client_sock = accept_sys(
      new BigInt(0, server_sock),
      sockaddr,
      sockaddr_len
    )

    if (bl_is_error(client_sock)) {
      error('ERROR: accept() failed')
      close_sys(server_sock)
      return false
    }

    const client_sock_num = (client_sock instanceof BigInt) ? client_sock.lo : client_sock
    log('Client connected')

    let payload
    try {
      payload = bl_read_payload_from_socket(client_sock_num, MAX_PAYLOAD_SIZE)
    } catch (e) {
      error('ERROR reading payload: ' + (e as Error).message)
      close_sys(client_sock_num)
      close_sys(server_sock)
      return false
    }

    log('Received ' + payload.size + ' bytes total')

    close_sys(client_sock_num)
    close_sys(server_sock)

    if (payload.size < 64) {
      error('ERROR: Payload too small')
      return false
    }

    BinLoader.skip_autoclose = false

    try {
      BinLoader.init(payload.buf, payload.size)
      BinLoader.run()
      log('Payload loaded successfully')
    } catch (e) {
      error('ERROR loading payload: ' + (e as Error).message)
      if ((e as Error).stack) log((e as Error).stack ?? '')
      return false
    }

    return true
  }

  // Main entry point with USB loader logic
  function bin_loader_main () {
    log('=== PS4 Payload Loader ===')

    // Priority 1: Check for USB payload on usb0-usb4 (like BD-JB does)
    for (const usb_path of USB_PAYLOAD_PATHS) {
      const usb_size = bl_file_exists(usb_path)

      if (usb_size > 0) {
        log('Found USB payload: ' + usb_path + ' (' + usb_size + ' bytes)')
        utils.notify('USB payload found!\nCopying to /data...')

        // Copy USB payload to /data for future use
        if (bl_copy_file(usb_path, DATA_PAYLOAD_PATH)) {
          log('Copied to ' + DATA_PAYLOAD_PATH)
        } else {
          log('Warning: Failed to copy to /data, running from USB')
        }

        // Load from USB
        return bl_load_from_file(usb_path, false)
      }
    }

    // Priority 2: Check for cached /data payload
    const data_size = bl_file_exists(DATA_PAYLOAD_PATH)
    if (data_size > 0) {
      log('Found cached payload: ' + DATA_PAYLOAD_PATH + ' (' + data_size + ' bytes)')
      return bl_load_from_file(DATA_PAYLOAD_PATH, false)
    }

    // Priority 3: Check for cached SANDBOX payload
    const sandbox_size = bl_file_exists(SANDBOX_PAYLOAD_PATH)
    if (sandbox_size > 0) {
      log('Found cached payload: ' + SANDBOX_PAYLOAD_PATH + ' (' + sandbox_size + ' bytes)')
      return bl_load_from_file(SANDBOX_PAYLOAD_PATH, false)
    }

    // Priority 4: Fall back to network loader
    error('No payload file found, starting network loader')
    utils.notify('No payload found.\nStarting network loader...')
    return bl_network_loader()
  }

  function bl_is_port_listening_localhost (port: number) {
    const sd = socket(BL_AF_INET, BL_SOCK_STREAM, 0)
    if (bl_is_error(sd)) return false
    const sd_num = (sd instanceof BigInt) ? sd.lo : sd

    const sockaddr = mem.malloc(16)
    for (let j = 0; j < 16; j++) mem.view(sockaddr).setUint8(j, 0)
    mem.view(sockaddr).setUint8(1, 2)
    mem.view(sockaddr).setUint8(2, (port >> 8) & 0xff)
    mem.view(sockaddr).setUint8(3, port & 0xff)
    mem.view(sockaddr).setUint8(4, 127)
    mem.view(sockaddr).setUint8(5, 0)
    mem.view(sockaddr).setUint8(6, 0)
    mem.view(sockaddr).setUint8(7, 1)

    const ret = connect_sys(new BigInt(0, sd_num), sockaddr, new BigInt(0, 16))
    close_sys(sd_num)

    return !bl_is_error(ret) && ret.eq(0)
  }

  // End of binloader_init() function
  // Call bin_loader_main() to start binloader

  function bl_init_elfldr () {
    if (bl_is_port_listening_localhost(9021)) {
      log('9021 already listening, skip /download0/elfldr.elf')
      jsmaf.setTimeout(function() {
        exit_sys(0)
      }, 1000)
    } else {
      bl_load_from_file('/download0/elfldr.elf', false)
    }
  }

  if ((payloadSelect === 'payload.bin') || (payloadSelect === undefined)) {
    bin_loader_main()
  } else if (payloadSelect === 'elfldr.elf') {
    bl_init_elfldr()
  } else {
    bl_load_from_file('/download0/' + payloadSelect, false)
  }

  return {
    bl_load_from_file,
    bl_network_loader
  }
}

// Verify function is defined
if (typeof binloader_init === 'function') {
  debug('binloader.js loaded - binloader_init() function ready')
} else {
  error('ERROR: binloader_init function not defined!')
}
