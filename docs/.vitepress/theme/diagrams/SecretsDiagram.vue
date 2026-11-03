<script setup lang="ts">
// Where a secret lives and where its password is: .circuit/secrets in git, the password outside git, and the value only on its way to the device.
</script>

<template>
    <figure class="circuit-diagram">
        <svg viewBox="0 0 1000 300" role="img" aria-labelledby="secrets-title">
            <title id="secrets-title">
                circuit secrets set encrypts a value with the password into .circuit/secrets, which git keeps. The password, in 1Password,
                the environment or typed when asked, stays out of git. Circuit decrypts the value only when it sends a command to the
                device.
            </title>
            <defs>
                <marker id="secrets-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 10 5 0 10z" class="ink-fill" />
                </marker>
            </defs>

            <!-- 1: you set a value -->
            <rect x="10" y="40" width="210" height="90" class="box" />
            <circle cx="10" cy="40" r="15" class="dot" />
            <text x="10" y="45" class="dot-text">1</text>
            <text x="115" y="78" class="title">You</text>
            <text x="115" y="104" class="mono">circuit secrets set NAME</text>

            <line x1="222" y1="85" x2="298" y2="85" class="arrow" marker-end="url(#secrets-arrow)" />
            <text x="260" y="72" class="note">encrypted</text>

            <!-- 2: .circuit/secrets, committed -->
            <rect x="300" y="20" width="330" height="130" class="code-box" />
            <circle cx="300" cy="20" r="15" class="dot" />
            <text x="300" y="25" class="dot-text">2</text>
            <text x="322" y="56" class="code-dim">.circuit/secrets</text>
            <text x="322" y="86" class="code">EDGE_01_PASSWORD="encrypted:AQx…"</text>
            <text x="322" y="112" class="code">SNMP="op://Network/SNMP/password"</text>
            <rect x="322" y="124" width="84" height="20" class="action" />
            <text x="330" y="139" class="chip-text on-yellow">COMMITTED</text>

            <!-- 3: the password, outside git -->
            <rect x="300" y="190" width="330" height="90" class="secret-box" />
            <circle cx="300" cy="190" r="15" class="dot" />
            <text x="300" y="195" class="dot-text">3</text>
            <text x="465" y="225" class="title">The password</text>
            <text x="465" y="250" class="mono">1Password, the environment, or typed</text>
            <rect x="322" y="258" width="140" height="18" class="chip-red" />
            <text x="330" y="272" class="chip-text">NEVER COMMITTED</text>

            <!-- 4: the device -->
            <line x1="632" y1="85" x2="768" y2="85" class="arrow" marker-end="url(#secrets-arrow)" />
            <line x1="632" y1="235" x2="700" y2="235" class="arrow-dashed" />
            <line x1="700" y1="235" x2="700" y2="90" class="arrow-dashed" />
            <text x="700" y="72" class="note">decrypted when sent</text>
            <rect x="770" y="40" width="220" height="90" class="box" />
            <circle cx="770" cy="40" r="15" class="dot" />
            <text x="770" y="45" class="dot-text">4</text>
            <text x="880" y="78" class="title">The device</text>
            <text x="880" y="104" class="mono">plans show &lt;redacted&gt;</text>
        </svg>
    </figure>
</template>
