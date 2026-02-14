<p align="center">
    <img width="25%" height="25%" alt="logo2" src="https://github.com/user-attachments/assets/5596a357-61c3-471c-9a1e-b8c3d6de33c8" />
</p>

<h1 align="center"> Vue-After-Free-Lite </h1>
<p  align="center">
    A PlayStation Vue userland code execution exploit for Playstation 4.
</p>

# Fork Info
Everything about this repo is base on [vue-after-free](https://github.com/Vuemony/vue-after-free). Please go there for more explanation about this exploit.

What I did:
  1. Removed UI. And replaced it with only console like screen.
  2. Removed some payloads. Only elfldr, fake-signin, ftp-server left.
  3. Added GoldHEN in `download0.dat` cache.
  4. Auto close after any payload has been loaded.
  5. Tweaked some scopes of JS functions and variables.
  6. No changes of the exploit processes.


# Vue After Free Userland
CVE-2018-4441 was shortly applied but due to instability and bad success rate it was dropped.    
CVE-2017-7117 is used for the userland, and has been chained with Lapse and Poopsploit(Netctrl) kernel exploits on respective firmwares marked below.

## Vulnerability Scope
KEX= Kernel Exploit
| vue-after-free (Userland) | Lapse (KEX) | Netctrl (KEX) |
| :------------------------ | :---------- | :--------------- |
| 5.05–13.04                | 1.01–12.02  | 1.01-13.00       |

## PS4 Firmware Versions Supported by this Repository

This table indicates firmware versions for which the _current version_ of this repository provides a functional tested jailbreak for.   

| 7.00-13.00 |
| :--------- |

* By default Lapse is used from 7.00 to 12.02, and Poopsploit from 12.50-13.00. Although you can choose to run Poopsploit on as low as 9.00.
* Userland exploit works 5.05 to 13.02 as is.

# FAQ
Q: Will this work on 13.02 or above? A: Only the userland, you cannot jailbreak above 13.00 with the files in this repo.    
Q: I ran Vue and the app crashed? A: If the app crashes the exploit failed reboot the console and try again.    
Q: I ran Vue and my console shutdown what do I do? A: If a kernel panic occurred you may need to press the power button on your console twice, then retry running the exploit.    
Q: How can I run a payload? A: Closing and Reopening Vue is required between running js payloads, but .bin or .elf payloads can be run one after the other. Select the payload from the UI in the Payload Menu.    
Q: Can I run the jailbreak offline? A: No. PS Vue requires any form of network connection, internet is not required as such you can use any network like home WiFi or Hotspot from your mobile phone or a network from a micro controller like ESP32 or an Ethernet network from a reporpused PPPwn device.     
Q: I am getting "This service requires you to sign in to PlayStation Network" even after replacing the save file how can I fix it? A: Your Vue app most likely updated, this usually happens when not using a DNS or blocking Sony servers in general. You will have to delete and reinstall it.     
Q: My payload is not recognized what should I do? A: Format your USB drive to mbr partition and exfat format. 

> [!IMPORTANT]
> The Vue save file may occasionally reset. To avoid issues please copy the encrypted save to a USB, from the PS4 settings menu for the user that is used to run the jailbreak, for easy future recovery.   

> [!IMPORTANT]
> DO NOT change your np environment via Debug Settings, it will cause you to be unable to use a backup save file. And makes it incompatible with the current fake sign in payload. 

## Update

## Requirements
### For Vue-After-Free Users
  * FTP client
  or
  * USB flash drive.

### For Jailbroken PS4
  * Fake or legit activated PS4 user account.
  * FTP access to the console.
  * USB flash drive.

  * PlayStation Vue 1.01 base and 1.24 patch.(Referred to as "PS Vue or Vue" later in the guide). [Download](https://www.mediafire.com/file/45owcabezln2ykm/CUSA00960.zip/file)   

### For Non-Jailbroken PS4
  I do not provide any system backup file. Because I don't have a PS4 with 7.00 firmware.
  Go refer to the original repo for the non-jailbroken PS4 setup. Then you can replace it with the files from this repo. [vue-after-free](https://github.com/Vuemony/vue-after-free#for-non-jailbroken-ps4)

# Setup Instructions
## For Vue-After-Free Users
  * Replace `/user/download/CUSA00960/download0.dat` via FTP after PS4 jailbroken. You could find the `download0.dat` file in `download0-lite.zip` from [relase page](/release)
  or
  * Replace all the files in `/mnt/sandbox/CUSA00960/download0/` via `ftp-server.js` in the Vue app. You don't even need to jailbreak your PS4 with this method. You could find all the dist files in `download0-dist-lite.zip` from [relase page](/release)

## Jailbroken PS4
A network connection of any kind is required, before trying to run Vue please connect to a local network even if it does not have internet. [Connection Instructions](https://github.com/Vuemony/vue-after-free?tab=readme-ov-file#connecting-to-the-internet)
  1. Jailbreak your console.
  2. Enable FTP.
  3. Install Apollo Save Tool. [Download](https://pkg-zone.com/details/APOL00004)
  4. Install PS Vue 1.01 pkg and 1.24 patch. [Download](https://www.mediafire.com/file/45owcabezln2ykm/CUSA00960.zip/file)
  5. Connect to the console with FTP.
  6. Download the `download0-lite.zip` from releases.
  7. Go to the following path with FTP `/user/download/CUSA00960` (create path if needed) and place `download0.dat` there.
  8. On your USB unpack the save.zip ( or FTP to `/data/fakeusb/` ). The files will show up in USB Saves as if it is a real USB. It can be toggled in Apollo Settings>USB Saves Sources to be the only thing displayed even while a real USB is plugged in.
  9. (Optional) GoldHEN is included in the `download0.dat` which could be auto loaded after jailbreak. Or in the root of your USB, you could place HEN or GoldHEN named as `payload.bin`. Or place it in `/data/`.
     `payload.bin` auto loading priority: USB > /data/ > download0.dat
  10. Plug the USB into the console.
  11. In Apollo Save Tool go to USB Saves and select the PS Vue save(CUSA00960) and choose the option "Copy save game to HDD".
  12. Connect PS4 to the Internet [b]without access to PSN[/b]. Refer to [Connecting to the internet](#connecting-to-the-internet)
  13. Reboot your console then open PS Vue run the exploit by pressing on the jailbreak button or configure the autoloader.
  14. Optionally after jailbreaking run the [np-fake-signin](https://github.com/Vuemony/vue-after-free/blob/main/README.md#np-fake-signin) payload to avoid the PSN pop-up.

## Non-Jailbroken PS4
  I do not provide any system backup file. Because I don't have a PS4 with 7.00 firmware.
  Go refer to the original repo for the non-jailbroken PS4 setup. [vue-after-free](https://github.com/Vuemony/vue-after-free#for-non-jailbroken-ps4)

# Connecting to the internet.
  1. Navigate to Settings > System > Automatic Downloads, and uncheck "Featured Content", "System Software Update Files" and "Application Update Files".
  2. Navigate to Settings > Network > Check Connect to the Internet, then Set Up Internet Connection.
  3. Connection: [s]Wi-Fi or[/s] LAN cable is recommended.
     Because Wi-Fi would connect to the Internet after you input the correct password before you setup a manual DNS. You either disconnect the WAN cable from your Wi-Fi device or router.
  4. Set Up: Custom
  5. IP Address: Automatic
  6. DHCP Host Name: Do Not Specify
  7. DNS Settings: Manual
  8. Primary DNS: 62.210.38.117 (Leave the secondary blank as it is)
  9. MTU Settings: Automatic
  10. Proxy Server: Do Not Use
  11. Test the internet connection if you get an IP address it's working.
  * The internet connection failing does not indicate that it actually cannot connect to the internet, it just means the PS4 cannot communicate with Sony servers which is the point of the DNS

# Payloads
Vue After Free Lite comes preloaded with some payloads.

## GoldHEN
It's included in the `download0.dat` from release page. It would be auto loaded after jailbreak if you don't have `payload.bin` at `/data/` or USB disk drive.

## FTP (Userland only)
The `ftp-server.ts` payload gives you sandbox FTP to quickly swap exploit or cosmetic files without running a kernel exploit/jailbreaking.

## ELFLDR (Needs jailbreak)
`elfldr.elf` is used to load elf and bin payloads post exploit when HEN or GoldHEN have not been loaded.

# NP-Fake-SignIn (Needs jailbreak)
The np-fake-signin payload gets rid of the first PS Vue pop-up asking you to sign into PSN. It can be launched from the payloads menu.
> [!IMPORTANT]
> The np-fake-signin should not be run on a real psn account.

# Creating a separate user
If you wish to use a new account instead of the default one in the system backup.
1. Create a new user.
2. Fake activate it with Apollo Save Tool from User Tools>Activate PS4 Accounts. (optionally with the Account ID you want) then Reboot the console.
3. On your USB unpack the save.zip from the VueManualSetup.zip in Releases.
4. In Apollo Save Tool go to USB Saves and select the PS Vue save(CUSA00960) and choose the option "Copy save game to HDD".

# Credits

- [c0w-ar](https://github.com/c0w-ar/) — Lapse and NetCtrl porting  , Reverse Engineering
- [earthonion](https://github.com/earthonion) — UI, initial JS injection, Payload host, Netctrl porting, binloader, Reverse engineering
- [ufm42](https://github.com/ufm42) — Userland Exploit and reverse engineering
- [D-Link Turtle](https://github.com/iMrDJAi) — General support for userland exploition
- [Gezine](https://github.com/gezine) — Local JS method and PSN bypass research
- [Helloyunho](https://github.com/Helloyunho) — TypeScript port  , Reverse Engineering
- [Dr.Yenyen](https://github.com/DrYenyen) — Extensive testing, quality control, and end‑user support/ideas
- [AlAzif](https://github.com/Al-Azif) — Reference for exploit table, retail application advice, Lapse AIO Fix kpatches and 12.50-13.00 kpatches.
- abc — Lapse
- [TheFlow](https://github.com/TheOfficialFloW) — NetCtrl
- [Lua Loader project](https://github.com/shahrilnet/remote_lua_loader) — Remote Lua loader foundation
- [Cryptogenic](https://github.com/Cryptogenic/PS4-6.20-WebKit-Code-Execution-Exploit) — Refence for CVE-2018-4441
- [rebelle3](https://github.com/rebelle3/cve-2017-7117) — Reference for CVE-2017-7117

## payload sources:
- [elfldr.elf](https://github.com/ps4-payload-dev/elfldr) by John Törnblom
- [AIOfix_network.elf](https://github.com/Gezine/BD-JB-1250/blob/main/payloads/lapse/src/org/bdj/external/aiofix_network.c) by Gezine
- [np-fake-signin](https://github.com/earthonion/np-fake-signin) by earthonion
- [GoldHEN](https://ko-fi.com/sistro) by SISTro
