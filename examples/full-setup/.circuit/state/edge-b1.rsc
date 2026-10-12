/interface ethernet switch
set switch1 l3-hw-offloading=yes
/interface ethernet switch l3hw-settings
set autorestart=yes ipv6-hw=yes
/interface bridge
add name=bridge protocol-mode=rstp priority=0x1000 vlan-filtering=yes
add comment="Router ID, iBGP, and the anycast resolver" name=loopback
/interface ethernet
set [ find default-name=qsfp28-1-1 ] comment=agg-b1
set [ find default-name=qsfp28-2-1 ] disabled=yes
set [ find default-name=sfp28-1 ] comment="Transit C"
set [ find default-name=sfp28-2 ] disabled=yes
set [ find default-name=sfp28-3 ] disabled=yes
set [ find default-name=sfp28-4 ] disabled=yes
set [ find default-name=sfp28-5 ] disabled=yes
set [ find default-name=sfp28-6 ] disabled=yes
set [ find default-name=sfp28-7 ] disabled=yes
set [ find default-name=sfp28-8 ] disabled=yes
set [ find default-name=sfp28-9 ] disabled=yes
set [ find default-name=sfp28-10 ] disabled=yes
set [ find default-name=sfp28-11 ] disabled=yes
set [ find default-name=sfp28-12 ] comment="Leased wave to edge-a2" mtu=9000
set [ find default-name=ether1 ] comment="Out-of-band switch"
/interface vlan
add interface=bridge name=mgmt vlan-id=99
add interface=bridge name=infra vlan-id=10
add comment="The site B office" interface=bridge name=office vlan-id=50
add comment="Transit C" interface=bridge name=transit-c vlan-id=302
add comment="Customer hanso" interface=bridge name=hanso vlan-id=1009
add comment="Customer oscorp" interface=bridge name=oscorp vlan-id=1010
add comment="Customer dunder" interface=bridge name=dunder vlan-id=1011
/interface gre
add comment="Backup path to site A, over the internet" local-address=203.0.113.10 mtu=1476 name=gre-a1 remote-address=203.0.113.2
/interface vxlan
add comment="The lab, stretched to site A" local-address=203.0.113.10 mac-address=02:00:00:00:b1:01 mtu=1450 name=vxlan-a1 vni=4010
/interface vxlan vteps
add interface=vxlan-a1 remote-ip=203.0.113.2
/interface wireguard
add comment="Site A's management, when nothing else reaches it" listen-port=51821 name=wg-a2 private-key="<secret:EDGE_B1_WG_KEY>"
add comment="Staff working from home" listen-port=51820 name=wg-staff private-key="<secret:EDGE_B1_WG_STAFF_KEY>"
/interface wireguard peers
add allowed-address="10.254.1.4/32,10.0.99.0/24" endpoint-address=203.0.113.6 endpoint-port=51821 interface=wg-a2 name=wg-a2-edge-a2 persistent-keepalive=25s public-key="ZXhhbXBsZSBlZGdlLWEyIG5vdCBhIHJlYWwga2V5Li4="
add allowed-address=10.254.3.11/32 client-allowed-address=10.1.50.0/24 interface=wg-staff name=wg-staff-staff-1 public-key="ZXhhbXBsZSBzdGFmZi0xIG5vdCBhIHJlYWwga2V5Li4="
add allowed-address=10.254.3.12/32 client-allowed-address=10.1.50.0/24 interface=wg-staff name=wg-staff-staff-2 public-key="ZXhhbXBsZSBzdGFmZi0yIG5vdCBhIHJlYWwga2V5Li4="
add allowed-address=10.254.3.13/32 client-allowed-address=10.1.50.0/24 interface=wg-staff name=wg-staff-staff-3 public-key="ZXhhbXBsZSBzdGFmZi0zIG5vdCBhIHJlYWwga2V5Li4="
add allowed-address=10.254.3.14/32 client-allowed-address=10.1.50.0/24 interface=wg-staff name=wg-staff-staff-4 public-key="ZXhhbXBsZSBzdGFmZi00IG5vdCBhIHJlYWwga2V5Li4="
add allowed-address=10.254.3.15/32 client-allowed-address=10.1.50.0/24 interface=wg-staff name=wg-staff-staff-5 public-key="ZXhhbXBsZSBzdGFmZi01IG5vdCBhIHJlYWwga2V5Li4="
add allowed-address="10.254.3.200/32,172.16.30.0/24" endpoint-address=lab.example.net endpoint-port=51820 interface=wg-staff name=wg-staff-lab persistent-keepalive=25s public-key="ZXhhbXBsZSBsYWIgbm90IGEgcmVhbCBrZXkuLi4uLi4="
/interface bridge port
add bridge=bridge frame-types=admit-only-vlan-tagged interface=qsfp28-1-1
add bridge=bridge frame-types=admit-only-untagged-and-priority-tagged interface=sfp28-1 pvid=302
/interface bridge vlan
add bridge=bridge comment="Management of every device at the site" tagged="bridge,qsfp28-1-1" vlan-ids=99
add bridge=bridge comment="OSPF between the site's routers and switches" tagged="bridge,qsfp28-1-1" vlan-ids=10
add bridge=bridge comment="Transit C, AS64503" tagged=bridge vlan-ids=302
add bridge=bridge comment="The site B office" tagged="bridge,qsfp28-1-1" vlan-ids=50
add bridge=bridge comment="Customer hanso" tagged="bridge,qsfp28-1-1" vlan-ids=1009
add bridge=bridge comment="Customer oscorp" tagged="bridge,qsfp28-1-1" vlan-ids=1010
add bridge=bridge comment="Customer dunder" tagged="bridge,qsfp28-1-1" vlan-ids=1011
/interface bridge filter
add action=drop chain=input comment="sfp28-1 out of spanning tree" dst-mac-address=01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF in-interface=sfp28-1
add action=drop chain=output comment="sfp28-1 out of spanning tree" dst-mac-address=01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF out-interface=sfp28-1
/interface list
add name=lldp
/interface list member
add interface=ether1 list=lldp
add interface=qsfp28-1-1 list=lldp
add interface=sfp28-12 list=lldp
/ip vrf
add comment="The out-of-band network, apart from everything else" interfaces=ether1 name=oob
/ip address
add address=10.9.1.1/24 comment="Out-of-band switch" interface=ether1
add address=10.254.0.3/31 comment="Leased wave to edge-a2" interface=sfp28-12
add address=198.51.100.3/32 comment="Router ID, iBGP, and the anycast resolver" interface=loopback
add address=198.51.100.10/32 comment="Router ID, iBGP, and the anycast resolver" interface=loopback
add address=10.1.99.1/24 interface=mgmt
add address=10.1.10.1/24 interface=infra
add address=10.1.50.1/24 comment="The site B office" interface=office
add address=203.0.113.10/30 comment="Transit C" interface=transit-c
add address=10.254.1.1/31 comment="Backup path to site A, over the internet" interface=gre-a1
add address=10.254.1.3/31 comment="The lab, stretched to site A" interface=vxlan-a1
add address=10.254.1.5/31 comment="Site A's management, when nothing else reaches it" interface=wg-a2
add address=10.254.3.1/24 comment="Staff working from home" interface=wg-staff
add address=198.51.100.129/28 comment="Customer hanso" interface=hanso
add address=198.51.100.145/28 comment="Customer oscorp" interface=oscorp
add address=198.51.100.161/29 comment="Customer dunder" interface=dunder
/ipv6 address
add address=2001:db8:100::3/128 advertise=no comment="Router ID, iBGP, and the anycast resolver" interface=loopback
add address=2001:db8:ffff:3::2/64 advertise=no comment="Transit C" interface=transit-c
add address=2001:db8:100:9::1/64 advertise=yes comment="Customer hanso" interface=hanso
add address=2001:db8:100:a::1/64 advertise=yes comment="Customer oscorp" interface=oscorp
/ip pool
add name=office ranges=10.1.50.100-10.1.50.199
/ip dhcp-server
add address-pool=office interface=office lease-time=8h name=office
/ip dhcp-server network
add address=10.1.50.0/24 dns-server=10.1.50.1 gateway=10.1.50.1
/ip dhcp-server lease
add address=10.1.50.10 comment=Printer mac-address=02:00:00:00:50:10 server=office
add address=10.1.50.11 comment="Phone system" mac-address=02:00:00:00:50:11 server=office
add address=10.1.50.12 comment="Door controller" mac-address=02:00:00:00:50:12 server=office
/ip dns
set allow-remote-requests=yes servers="10.0.20.53,10.0.20.54"
/ip firewall address-list
add address=10.0.99.0/24 list=admin
add address=10.1.99.0/24 list=admin
add address=10.254.2.0/24 list=admin
add address=10.0.20.30 list=monitoring
add address=10.0.20.31 list=monitoring
add address=203.0.113.9 list=bgp-neighbors
add address=198.51.100.1 list=bgp-neighbors
add address=198.51.100.2 list=bgp-neighbors
add address=203.0.113.2 list=tunnel-peers
add address=198.51.100.0/24 list=ours
add address=192.0.2.0/24 list=acme-v4
add address=198.51.100.0/24 list=bgp-networks-v4
/ipv6 firewall address-list
add address=2001:db8:ffff:3::1 list=bgp-neighbors
add address=2001:db8:100::1 list=bgp-neighbors
add address=2001:db8:100::2 list=bgp-neighbors
add address=2001:db8:100:a::4 list=bgp-neighbors
add address=2001:db8:100::/48 list=ours
add address=2001:db8:201::/48 list=acme-v6
add address=2001:db8:202::/48 list=globex-v6
add address=2001:db8:203::/48 list=cyberdyne-v6
add address=2001:db8:204::/48 list=oscorp-v6
add address=2001:db8:100::/48 list=bgp-networks-v6
/ip firewall filter
add action=accept chain=input comment=Replies connection-state="established,related"
add action=drop chain=input comment=Invalid connection-state=invalid
add action=accept chain=input comment=Ping protocol=icmp
add action=accept chain=input comment=Management dst-port="22,443,8729" protocol=tcp src-address-list=admin
add action=accept chain=input comment=SNMP dst-port=161 protocol=udp src-address-list=monitoring
add action=accept chain=input comment=BGP dst-port=179 protocol=tcp src-address-list=bgp-neighbors
add action=accept chain=input comment=BFD dst-port=3784-3785 protocol=udp
add action=accept chain=input comment=OSPF protocol=ospf
add action=accept chain=input comment=VRRP protocol=vrrp
add action=accept chain=input comment=GRE protocol=gre src-address-list=tunnel-peers
add action=accept chain=input comment=VXLAN dst-port=4789 protocol=udp src-address-list=tunnel-peers
add action=accept chain=input comment=WireGuard dst-port="51820,51821" protocol=udp
add action=accept chain=input comment="DNS for customers, UDP" dst-port=53 protocol=udp src-address-list=ours
add action=accept chain=input comment="DNS for customers, TCP" dst-port=53 protocol=tcp src-address-list=ours
add action=accept chain=input comment="NTP for customers" dst-port=123 protocol=udp src-address-list=ours
add action=drop chain=input comment=Default
add action=fasttrack-connection chain=forward comment=Replies connection-state="established,related"
add action=accept chain=forward comment=Replies connection-state="established,related"
add action=drop chain=forward comment=Invalid connection-state=invalid
add action=drop chain=forward comment="Bad flags FIN+SYN" protocol=tcp tcp-flags="fin,syn"
add action=drop chain=forward comment="Bad flags SYN+RST" protocol=tcp tcp-flags="syn,rst"
add action=drop chain=forward comment="Bad flags FIN+RST" protocol=tcp tcp-flags="fin,rst"
add action=drop chain=forward comment="Bad flags FIN without ACK" protocol=tcp tcp-flags="fin,!ack"
add action=drop chain=forward comment="Bad flags FIN+URG" protocol=tcp tcp-flags="fin,urg"
add action=drop chain=forward comment="Bad flags Xmas scan" protocol=tcp tcp-flags="fin,syn,psh,urg"
add action=drop chain=forward comment="Remote desktop and telnet from transit-c" dst-port="23,3389,5900" in-interface=transit-c protocol=tcp
/ip firewall nat
add action=masquerade chain=srcnat comment="Management out through transit-c" out-interface=transit-c src-address=10.0.0.0/8
/ipv6 firewall filter
add action=accept chain=input comment=Replies connection-state="established,related"
add action=drop chain=input comment=Invalid connection-state=invalid
add action=accept chain=input comment=Ping protocol=icmpv6
add action=accept chain=input comment=BGP dst-port=179 protocol=tcp src-address-list=bgp-neighbors
add action=accept chain=input comment=BFD dst-port=3784-3785 protocol=udp
add action=accept chain=input comment=OSPF protocol=ospf
add action=accept chain=input comment=VRRP protocol=vrrp
add action=accept chain=input comment=WireGuard dst-port="51820,51821" protocol=udp
add action=accept chain=input comment="DNS for customers, UDP" dst-port=53 protocol=udp src-address-list=ours
add action=accept chain=input comment="DNS for customers, TCP" dst-port=53 protocol=tcp src-address-list=ours
add action=accept chain=input comment="NTP for customers" dst-port=123 protocol=udp src-address-list=ours
add action=drop chain=input comment=Default
add action=accept chain=forward comment=Replies connection-state="established,related"
add action=drop chain=forward comment=Invalid connection-state=invalid
add action=drop chain=forward comment="Bad flags FIN+SYN" protocol=tcp tcp-flags="fin,syn"
add action=drop chain=forward comment="Bad flags SYN+RST" protocol=tcp tcp-flags="syn,rst"
add action=drop chain=forward comment="Bad flags FIN+RST" protocol=tcp tcp-flags="fin,rst"
add action=drop chain=forward comment="Bad flags FIN without ACK" protocol=tcp tcp-flags="fin,!ack"
add action=drop chain=forward comment="Bad flags FIN+URG" protocol=tcp tcp-flags="fin,urg"
add action=drop chain=forward comment="Bad flags Xmas scan" protocol=tcp tcp-flags="fin,syn,psh,urg"
add action=drop chain=forward comment="Remote desktop and telnet from transit-c" dst-port="23,3389,5900" in-interface=transit-c protocol=tcp
/ip firewall service-port
set ftp disabled=no
set tftp disabled=yes
set irc disabled=yes
set h323 disabled=yes
set sip disabled=yes
set pptp disabled=yes
set rtsp disabled=yes
/interface ethernet switch rule
add comment="transit-c: drop source 198.51.100.0/24" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=198.51.100.0/255.255.255.0 switch=switch1 vlan-id=302
add comment="transit-c: drop source 127.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=127.0.0.0/255.0.0.0 switch=switch1 vlan-id=302
add comment="transit-c: drop source 169.254.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=169.254.0.0/255.255.0.0 switch=switch1 vlan-id=302
add comment="transit-c: drop source 0.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=0.0.0.0/255.0.0.0 switch=switch1 vlan-id=302
add comment="transit-c: drop source 10.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=10.0.0.0/255.0.0.0 switch=switch1 vlan-id=302
add comment="transit-c: drop source 172.16.0.0/12" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=172.16.0.0/255.240.0.0 switch=switch1 vlan-id=302
add comment="transit-c: drop source 192.168.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=192.168.0.0/255.255.0.0 switch=switch1 vlan-id=302
add comment="UDP fragments to 198.51.100.16/28" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=0 switch=switch1
add comment="UDP to 198.51.100.16/28 from qotd" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=17 switch=switch1
add comment="UDP to 198.51.100.16/28 from chargen" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=19 switch=switch1
add comment="UDP to 198.51.100.16/28 from dns, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=0-52 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.16/28 from dns, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=54-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.16/28 from portmap" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=111 switch=switch1
add comment="UDP to 198.51.100.16/28 from ntp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=0-122 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.16/28 from ntp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=124-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.16/28 from netbios" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=137 switch=switch1
add comment="UDP to 198.51.100.16/28 from snmp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=0-160 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.16/28 from snmp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=162-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.16/28 from cldap" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=389 switch=switch1
add comment="UDP to 198.51.100.16/28 from slp" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=427 switch=switch1
add comment="UDP to 198.51.100.16/28 from rip" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=520 switch=switch1
add comment="UDP to 198.51.100.16/28 from ms-sql" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=1434 switch=switch1
add comment="UDP to 198.51.100.16/28 from ssdp" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=1900 switch=switch1
add comment="UDP to 198.51.100.16/28 from ard" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=3283 switch=switch1
add comment="UDP to 198.51.100.16/28 from ws-discovery" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=3702 switch=switch1
add comment="UDP to 198.51.100.16/28 from mdns" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=5353 switch=switch1
add comment="UDP to 198.51.100.16/28 from coap" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=5683 switch=switch1
add comment="UDP to 198.51.100.16/28 from ubiquiti" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=10001 switch=switch1
add comment="UDP to 198.51.100.16/28 from memcached" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=11211 switch=switch1
add comment="UDP to 198.51.100.16/28 from dvr" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=37810 switch=switch1
add comment="UDP fragments to 198.51.100.64/27" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=0 switch=switch1
add comment="UDP to 198.51.100.64/27 from qotd" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=17 switch=switch1
add comment="UDP to 198.51.100.64/27 from chargen" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=19 switch=switch1
add comment="UDP to 198.51.100.64/27 from dns, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=0-52 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.64/27 from dns, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=54-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.64/27 from portmap" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=111 switch=switch1
add comment="UDP to 198.51.100.64/27 from ntp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=0-122 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.64/27 from ntp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=124-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.64/27 from netbios" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=137 switch=switch1
add comment="UDP to 198.51.100.64/27 from snmp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=0-160 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.64/27 from snmp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=162-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.64/27 from cldap" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=389 switch=switch1
add comment="UDP to 198.51.100.64/27 from slp" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=427 switch=switch1
add comment="UDP to 198.51.100.64/27 from rip" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=520 switch=switch1
add comment="UDP to 198.51.100.64/27 from ms-sql" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=1434 switch=switch1
add comment="UDP to 198.51.100.64/27 from ssdp" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=1900 switch=switch1
add comment="UDP to 198.51.100.64/27 from ard" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=3283 switch=switch1
add comment="UDP to 198.51.100.64/27 from ws-discovery" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=3702 switch=switch1
add comment="UDP to 198.51.100.64/27 from mdns" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=5353 switch=switch1
add comment="UDP to 198.51.100.64/27 from coap" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=5683 switch=switch1
add comment="UDP to 198.51.100.64/27 from ubiquiti" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=10001 switch=switch1
add comment="UDP to 198.51.100.64/27 from memcached" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=11211 switch=switch1
add comment="UDP to 198.51.100.64/27 from dvr" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-1 protocol=udp src-port=37810 switch=switch1
/ip route
add blackhole comment=Originate dst-address=198.51.100.0/24
add comment="Out-of-band exit" dst-address=0.0.0.0/0 gateway=10.9.1.254 routing-table=oob
add comment="Site A management, last resort" distance=200 dst-address=10.0.99.0/24 gateway=wg-a2
add comment="The lab" dst-address=172.16.30.0/24 gateway=wg-staff
/ipv6 route
add blackhole comment=Originate dst-address=2001:db8:100::/48
/routing rpki
add address=10.0.20.80 comment="Validator 1" group=rpki port=323
add address=10.0.20.81 comment="Validator 2" group=rpki port=8282
/routing bgp instance
add as=64500 name=default router-id=198.51.100.3
/routing filter rule
add chain=CUSTOMER-OSCORP-IN-V6 comment="Blackhole, asked by the neighbor" rule="if (dst in oscorp-v6 && bgp-large-communities includes 64500:666:0) { set blackhole yes; accept }"
add chain=CUSTOMER-OSCORP-IN-V6 rule="jump SANITY-V6"
add chain=CUSTOMER-OSCORP-IN-V6 comment="Learned from AS65541" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:1:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:2:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:3:[0-9]+\$\"; append bgp-large-communities 64500:1:4,64500:2:2,64500:3:65541"
add chain=CUSTOMER-OSCORP-IN-V6 comment="Their space, oscorp-v6" rule="if (dst in oscorp-v6) { set bgp-local-pref 300; accept }"
add chain=CUSTOMER-OSCORP-IN-V6 comment="Nothing else" rule=reject
add chain=CUSTOMER-OUT-V6 comment="The full table" rule=accept
add chain=IBGP-IN-V4 comment="Everything our other edge routers pass on" rule=accept
add chain=IBGP-IN-V6 comment="Everything our other edge routers pass on" rule=accept
add chain=IBGP-OUT-V4 comment="Our IPv4" rule="if (dst==198.51.100.0/24) { accept }"
add chain=IBGP-OUT-V4 comment="Learned from a transit" rule="if (bgp-large-communities includes 64500:1:1) { accept }"
add chain=IBGP-OUT-V4 comment="Learned from a exchange" rule="if (bgp-large-communities includes 64500:1:2) { accept }"
add chain=IBGP-OUT-V4 comment="Learned from a peer" rule="if (bgp-large-communities includes 64500:1:3) { accept }"
add chain=IBGP-OUT-V4 comment="Learned from a customer" rule="if (bgp-large-communities includes 64500:1:4) { accept }"
add chain=IBGP-OUT-V4 comment="Nothing untagged" rule=reject
add chain=IBGP-OUT-V6 comment="Our IPv6" rule="if (dst==2001:db8:100::/48) { accept }"
add chain=IBGP-OUT-V6 comment="Learned from a transit" rule="if (bgp-large-communities includes 64500:1:1) { accept }"
add chain=IBGP-OUT-V6 comment="Learned from a exchange" rule="if (bgp-large-communities includes 64500:1:2) { accept }"
add chain=IBGP-OUT-V6 comment="Learned from a peer" rule="if (bgp-large-communities includes 64500:1:3) { accept }"
add chain=IBGP-OUT-V6 comment="Learned from a customer" rule="if (bgp-large-communities includes 64500:1:4) { accept }"
add chain=IBGP-OUT-V6 comment="Nothing untagged" rule=reject
add chain=SANITY-V4 comment="IPv4 shorter than /8" rule="if (dst-len<8) { reject }"
add chain=SANITY-V4 comment="IPv4 longer than /24" rule="if (dst-len>24) { reject }"
add chain=SANITY-V4 comment="RPKI invalid" rule="rpki-verify rpki; if (rpki invalid) { reject }"
add chain=SANITY-V6 comment="IPv6 shorter than /16" rule="if (dst-len<16) { reject }"
add chain=SANITY-V6 comment="IPv6 longer than /48" rule="if (dst-len>48) { reject }"
add chain=SANITY-V6 comment="RPKI invalid" rule="rpki-verify rpki; if (rpki invalid) { reject }"
add chain=TRANSIT-C-IN-V4 rule="jump SANITY-V4"
add chain=TRANSIT-C-IN-V4 comment="Learned from AS64503" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:1,64500:2:2,64500:3:64503"
add chain=TRANSIT-C-IN-V4 rule="set bgp-local-pref 100"
add chain=TRANSIT-C-IN-V4 rule=accept
add chain=TRANSIT-C-IN-V6 rule="jump SANITY-V6"
add chain=TRANSIT-C-IN-V6 comment="Learned from AS64503" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:1,64500:2:2,64500:3:64503"
add chain=TRANSIT-C-IN-V6 rule="set bgp-local-pref 100"
add chain=TRANSIT-C-IN-V6 rule=accept
add chain=TRANSIT-C-OUT-V4 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=TRANSIT-C-OUT-V4 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=TRANSIT-C-OUT-V4 comment="Asked not to be announced to AS64503" rule="if (bgp-large-communities includes 64500:100:64503) { reject }"
add chain=TRANSIT-C-OUT-V4 comment="Asked to prepend once to AS64503" rule="if (bgp-large-communities includes 64500:101:64503) { set bgp-path-prepend 1 }"
add chain=TRANSIT-C-OUT-V4 comment="Asked to prepend twice to AS64503" rule="if (bgp-large-communities includes 64500:102:64503) { set bgp-path-prepend 2 }"
add chain=TRANSIT-C-OUT-V4 comment="Asked to prepend three times to AS64503" rule="if (bgp-large-communities includes 64500:103:64503) { set bgp-path-prepend 3 }"
add chain=TRANSIT-C-OUT-V4 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=TRANSIT-C-OUT-V4 comment="Our IPv4" rule="if (dst==198.51.100.0/24) { accept }"
add chain=TRANSIT-C-OUT-V4 comment="Customer space acme-v4" rule="if (dst in acme-v4) { accept }"
add chain=TRANSIT-C-OUT-V4 comment="Nothing else leaves" rule=reject
add chain=TRANSIT-C-OUT-V6 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=TRANSIT-C-OUT-V6 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=TRANSIT-C-OUT-V6 comment="Asked not to be announced to AS64503" rule="if (bgp-large-communities includes 64500:100:64503) { reject }"
add chain=TRANSIT-C-OUT-V6 comment="Asked to prepend once to AS64503" rule="if (bgp-large-communities includes 64500:101:64503) { set bgp-path-prepend 1 }"
add chain=TRANSIT-C-OUT-V6 comment="Asked to prepend twice to AS64503" rule="if (bgp-large-communities includes 64500:102:64503) { set bgp-path-prepend 2 }"
add chain=TRANSIT-C-OUT-V6 comment="Asked to prepend three times to AS64503" rule="if (bgp-large-communities includes 64500:103:64503) { set bgp-path-prepend 3 }"
add chain=TRANSIT-C-OUT-V6 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=TRANSIT-C-OUT-V6 comment="Our IPv6" rule="if (dst==2001:db8:100::/48) { accept }"
add chain=TRANSIT-C-OUT-V6 comment="Customer space acme-v6" rule="if (dst in acme-v6) { accept }"
add chain=TRANSIT-C-OUT-V6 comment="Customer space globex-v6" rule="if (dst in globex-v6) { accept }"
add chain=TRANSIT-C-OUT-V6 comment="Customer space cyberdyne-v6" rule="if (dst in cyberdyne-v6) { accept }"
add chain=TRANSIT-C-OUT-V6 comment="Customer space oscorp-v6" rule="if (dst in oscorp-v6) { accept }"
add chain=TRANSIT-C-OUT-V6 comment="Nothing else leaves" rule=reject
/routing bgp connection
add as=64500 input.filter=TRANSIT-C-IN-V4 instance=default input.limit-process-routes-ipv4=1200000 local.role=ebgp-customer name=transit-c-v4 output.filter-chain=TRANSIT-C-OUT-V4 output.network=bgp-networks-v4 remote.address=203.0.113.9/32 remote.as=64503
add as=64500 input.filter=TRANSIT-C-IN-V6 instance=default input.limit-process-routes-ipv6=250000 local.role=ebgp-customer name=transit-c-v6 output.filter-chain=TRANSIT-C-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:ffff:3::1/128 remote.as=64503
add as=64500 input.filter=IBGP-IN-V4 instance=default local.address=198.51.100.3 local.role=ibgp name=edge-a1-v4 output.filter-chain=IBGP-OUT-V4 output.network=bgp-networks-v4 remote.address=198.51.100.1/32 remote.as=64500
add as=64500 input.filter=IBGP-IN-V6 instance=default local.address=2001:db8:100::3 local.role=ibgp name=edge-a1-v6 output.filter-chain=IBGP-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100::1/128 remote.as=64500
add as=64500 input.filter=IBGP-IN-V4 instance=default local.address=198.51.100.3 local.role=ibgp name=edge-a2-v4 output.filter-chain=IBGP-OUT-V4 output.network=bgp-networks-v4 remote.address=198.51.100.2/32 remote.as=64500
add as=64500 input.filter=IBGP-IN-V6 instance=default local.address=2001:db8:100::3 local.role=ibgp name=edge-a2-v6 output.filter-chain=IBGP-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100::2/128 remote.as=64500
add as=64500 input.filter=CUSTOMER-OSCORP-IN-V6 instance=default input.limit-process-routes-ipv6=10 local.role=ebgp-provider name=oscorp-v6 output.filter-chain=CUSTOMER-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100:a::4/128 remote.as=65541
/routing ospf instance
add name=ospf-v2 redistribute="connected,static" router-id=198.51.100.3 version=2
/routing ospf area
add area-id=0.0.0.0 instance=ospf-v2 name=ospf-v2-0.0.0.0
add area-id=0.0.0.1 instance=ospf-v2 name=ospf-v2-0.0.0.1
/routing ospf interface-template
add passive area=ospf-v2-0.0.0.0 interfaces=loopback
add area=ospf-v2-0.0.0.0 cost=100 interfaces=sfp28-12 type=ptp use-bfd=yes
add area=ospf-v2-0.0.0.0 cost=1000 interfaces=gre-a1 type=ptp
add area=ospf-v2-0.0.0.1 cost=10 interfaces=infra
add passive area=ospf-v2-0.0.0.1 interfaces=mgmt
add passive area=ospf-v2-0.0.0.1 interfaces=office
/routing bfd configuration
add interfaces=all
/ip service
set ftp disabled=yes
set ssh address="10.0.99.0/24,10.1.99.0/24,10.254.2.0/24" disabled=no
set telnet disabled=yes
set www disabled=yes
set www-ssl address="10.0.99.0/24,10.1.99.0/24,10.254.2.0/24" certificate=web disabled=no
set api disabled=yes
set api-ssl address=10.0.20.30/32 certificate=web disabled=no
set winbox disabled=yes
set reverse-proxy disabled=yes
/ip ssh
set strong-crypto=yes
/tool mac-server
set allowed-interface-list=none
/tool mac-server mac-winbox
set allowed-interface-list=none
/tool mac-server ping
set enabled=no
/tool bandwidth-server
set enabled=no
/ip neighbor discovery-settings
set discover-interface-list=lldp protocol=lldp
/snmp
set contact=noc@example.net enabled=yes location="Site B, rack 1"
/snmp community
set [ find default=yes ] addresses="10.0.20.30/32,10.0.20.31/32" name="<secret:EDGE_SNMP_COMMUNITY>"
add addresses="10.0.20.30/32,10.0.20.31/32" authentication-password="<secret:EDGE_SNMP_AUTH>" authentication-protocol=SHA1 encryption-password="<secret:EDGE_SNMP_PRIVACY>" encryption-protocol=AES name=monitor security=private
/user
add comment=Circuit group=full name=operator password="<secret:EDGE_OPERATOR_PASSWORD>"
add comment="The NOC on call" group=write name=noc password="<secret:EDGE_NOC_PASSWORD>"
add comment=Monitoring group=read name=monitor password="<secret:EDGE_MONITOR_PASSWORD>"
/user ssh-keys
add key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyOnlyForTheExampleNotARealKey00001 noc-1" user=noc
add key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyOnlyForTheExampleNotARealKey00002 noc-2" user=noc
/certificate
add fingerprint=8767232e8f0b0020ba8a20fc449016c9c2b1f149a75a79dd08fa62ffc27af5f0 name=web private-key=yes
/ip settings
set send-redirects=no tcp-syncookies=yes
/system identity
set name=edge-b1
/system clock
set time-zone-autodetect=no time-zone-name=Asia/Jakarta
/system note
set note="Authorised access only. Every session is logged." show-at-login=yes
/system ntp client
set enabled=yes
/system ntp server
set enabled=yes
/system ntp client servers
add address=10.0.20.123
add address=10.0.20.124
/system logging action
set 1 disk-file-count=5 disk-lines-per-file=10000
add name=remote1 remote=10.0.20.14 target=remote
/system logging
add action=disk topics=critical
add action=disk topics=error
add action=disk topics=warning
add action=remote1 topics=critical
add action=remote1 topics=error
add action=remote1 topics=warning
add action=remote1 topics=info
/system package update
set channel=long-term
/system routerboard settings
set enter-setup-on=delete-key
/ip traffic-flow
set enabled=yes interfaces=transit-c packet-sampling=yes sampling-interval=1000 sampling-space=1
/ip traffic-flow target
add dst-address=10.0.20.40 port=2055 version=9
