/interface ethernet switch
set switch1 l3-hw-offloading=yes
/interface ethernet switch l3hw-settings
set autorestart=yes ipv6-hw=yes
/interface bridge
add name=bridge protocol-mode=rstp priority=0x4000 vlan-filtering=yes
add comment="Router ID, iBGP, and the anycast resolver" name=loopback
/interface ethernet
set [ find default-name=qsfp28-1-1 ] comment=edge-a2 mtu=9000
set [ find default-name=qsfp28-2-1 ] auto-negotiation=no comment=core-a1 speed=40G-baseSR4-LR4
set [ find default-name=sfp28-1 ] comment="Transit A"
set [ find default-name=sfp28-2 ] comment="Example IX"
set [ find default-name=sfp28-3 ] disabled=yes
set [ find default-name=sfp28-4 ] disabled=yes
set [ find default-name=sfp28-5 ] disabled=yes
set [ find default-name=sfp28-6 ] disabled=yes
set [ find default-name=sfp28-7 ] disabled=yes
set [ find default-name=sfp28-8 ] disabled=yes
set [ find default-name=sfp28-9 ] disabled=yes
set [ find default-name=sfp28-10 ] disabled=yes
set [ find default-name=sfp28-11 ] disabled=yes
set [ find default-name=sfp28-12 ] disabled=yes
set [ find default-name=ether1 ] comment="Out-of-band switch"
/interface vlan
add interface=bridge name=mgmt vlan-id=99
add interface=bridge name=infra vlan-id=10
add comment="Transit A" interface=bridge name=transit-a vlan-id=300
add comment="Example IX" interface=bridge l3-hw-offloading=no name=ix vlan-id=200
add comment="Customer acme" interface=bridge name=acme vlan-id=1001
add comment="Customer globex" interface=bridge name=globex vlan-id=1002
add comment="Customer initech" interface=bridge name=initech vlan-id=1003
add comment="Customer vandelay" interface=bridge name=vandelay vlan-id=1004
add comment="Customer soylent" interface=bridge name=soylent vlan-id=1005
add comment="Customer cyberdyne" interface=bridge name=cyberdyne vlan-id=1006
add comment="Customer tyrell" interface=bridge name=tyrell vlan-id=1007
add comment="Customer wonka" interface=bridge name=wonka vlan-id=1008
/interface gre
add comment="Backup path to site B, over the internet" local-address=203.0.113.2 mtu=1476 name=gre-b1 remote-address=203.0.113.10
/interface vxlan
add comment="Site B's lab, stretched to site A" local-address=203.0.113.2 mac-address=02:00:00:00:a1:01 mtu=1450 name=vxlan-b1 vni=4010
/interface vxlan vteps
add interface=vxlan-b1 remote-ip=203.0.113.10
/interface wireguard
add comment="The NOC's VPN" listen-port=51820 name=wg-noc private-key="<secret:EDGE_A1_WG_NOC_KEY>"
/interface wireguard peers
add allowed-address=10.254.2.11/32 client-allowed-address=10.0.0.0/8 interface=wg-noc name=wg-noc-noc-laptop-1 public-key="ZXhhbXBsZSBub2MtbGFwdG9wLTEgbm90IGEgcmVhbCA="
add allowed-address=10.254.2.12/32 client-allowed-address=10.0.0.0/8 interface=wg-noc name=wg-noc-noc-laptop-2 public-key="ZXhhbXBsZSBub2MtbGFwdG9wLTIgbm90IGEgcmVhbCA="
add allowed-address=10.254.2.13/32 client-allowed-address=10.0.0.0/8 interface=wg-noc name=wg-noc-noc-laptop-3 public-key="ZXhhbXBsZSBub2MtbGFwdG9wLTMgbm90IGEgcmVhbCA="
add allowed-address=10.254.2.14/32 client-allowed-address=10.0.0.0/8 interface=wg-noc name=wg-noc-noc-laptop-4 public-key="ZXhhbXBsZSBub2MtbGFwdG9wLTQgbm90IGEgcmVhbCA="
add allowed-address="10.254.2.100/32,10.50.0.0/24" endpoint-address=monitor.example.net endpoint-port=51820 interface=wg-noc name=wg-noc-monitoring persistent-keepalive=25s public-key="ZXhhbXBsZSBtb25pdG9yaW5nIG5vdCBhIHJlYWwga2U="
/interface vrrp
add interface=mgmt name=mgmt-vrrp99 preemption-mode=yes priority=200 vrid=99
add interface=infra name=infra-vrrp10 preemption-mode=yes priority=200 vrid=10
add interface=acme name=acme-vrrp101 preemption-mode=yes priority=200 vrid=101
add interface=globex name=globex-vrrp102 preemption-mode=yes priority=200 vrid=102
add interface=initech name=initech-vrrp103 preemption-mode=yes priority=200 vrid=103
add interface=vandelay name=vandelay-vrrp104 preemption-mode=yes priority=200 vrid=104
add interface=soylent name=soylent-vrrp105 preemption-mode=yes priority=200 vrid=105
add interface=cyberdyne name=cyberdyne-vrrp106 preemption-mode=yes priority=200 vrid=106
add interface=tyrell name=tyrell-vrrp107 preemption-mode=yes priority=200 vrid=107
add interface=wonka name=wonka-vrrp108 preemption-mode=yes priority=200 vrid=108
/interface bridge port
add bridge=bridge frame-types=admit-only-vlan-tagged interface=qsfp28-2-1 path-cost=100
add bridge=bridge frame-types=admit-only-untagged-and-priority-tagged interface=sfp28-1 pvid=300
add bridge=bridge frame-types=admit-only-untagged-and-priority-tagged interface=sfp28-2 pvid=200
/interface bridge vlan
add bridge=bridge comment="Management of every device at the site" tagged="bridge,qsfp28-2-1" vlan-ids=99
add bridge=bridge comment="OSPF between the site's routers and switches" tagged="bridge,qsfp28-2-1" vlan-ids=10
add bridge=bridge comment="Transit A, AS64501" tagged=bridge vlan-ids=300
add bridge=bridge comment="Peering LAN of Example IX" tagged=bridge vlan-ids=200
add bridge=bridge comment="Customer acme" tagged="bridge,qsfp28-2-1" vlan-ids=1001
add bridge=bridge comment="Customer globex" tagged="bridge,qsfp28-2-1" vlan-ids=1002
add bridge=bridge comment="Customer initech" tagged="bridge,qsfp28-2-1" vlan-ids=1003
add bridge=bridge comment="Customer vandelay" tagged="bridge,qsfp28-2-1" vlan-ids=1004
add bridge=bridge comment="Customer soylent" tagged="bridge,qsfp28-2-1" vlan-ids=1005
add bridge=bridge comment="Customer cyberdyne" tagged="bridge,qsfp28-2-1" vlan-ids=1006
add bridge=bridge comment="Customer tyrell" tagged="bridge,qsfp28-2-1" vlan-ids=1007
add bridge=bridge comment="Customer wonka" tagged="bridge,qsfp28-2-1" vlan-ids=1008
/interface bridge filter
add action=drop chain=input comment="sfp28-1 out of spanning tree" dst-mac-address=01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF in-interface=sfp28-1
add action=drop chain=output comment="sfp28-1 out of spanning tree" dst-mac-address=01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF out-interface=sfp28-1
add action=drop chain=input comment="sfp28-2 out of spanning tree" dst-mac-address=01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF in-interface=sfp28-2
add action=drop chain=output comment="sfp28-2 out of spanning tree" dst-mac-address=01:80:C2:00:00:00/FF:FF:FF:FF:FF:FF out-interface=sfp28-2
/interface list
add name=lldp
add name=native
/interface list member
add interface=qsfp28-1-1 list=lldp
add interface=qsfp28-2-1 list=lldp
add interface=mgmt list=lldp
add interface=mgmt list=native
/ip vrf
add comment="The out-of-band network, apart from everything else" interfaces=ether1 name=oob
/ip address
add address=10.9.0.1/24 comment="Out-of-band switch" interface=ether1
add address=10.254.0.0/31 comment=edge-a2 interface=qsfp28-1-1
add address=198.51.100.1/32 comment="Router ID, iBGP, and the anycast resolver" interface=loopback
add address=198.51.100.10/32 comment="Router ID, iBGP, and the anycast resolver" interface=loopback
add address=10.0.99.2/24 interface=mgmt
add address=10.0.99.1/32 comment="VRRP 99 on mgmt" interface=mgmt-vrrp99
add address=10.0.10.2/24 interface=infra
add address=10.0.10.1/32 comment="VRRP 10 on infra" interface=infra-vrrp10
add address=203.0.113.2/30 comment="Transit A" interface=transit-a
add address=203.0.113.140/25 comment="Example IX" interface=ix
add address=10.254.1.0/31 comment="Backup path to site B, over the internet" interface=gre-b1
add address=10.254.1.2/31 comment="Site B's lab, stretched to site A" interface=vxlan-b1
add address=10.254.2.1/24 comment="The NOC's VPN" interface=wg-noc
add address=198.51.100.18/28 comment="Customer acme" interface=acme
add address=198.51.100.17/32 comment="VRRP 101 on acme" interface=acme-vrrp101
add address=198.51.100.34/28 comment="Customer globex" interface=globex
add address=198.51.100.33/32 comment="VRRP 102 on globex" interface=globex-vrrp102
add address=198.51.100.50/29 comment="Customer initech" interface=initech
add address=198.51.100.49/32 comment="VRRP 103 on initech" interface=initech-vrrp103
add address=198.51.100.58/29 comment="Customer vandelay" interface=vandelay
add address=198.51.100.57/32 comment="VRRP 104 on vandelay" interface=vandelay-vrrp104
add address=198.51.100.66/27 comment="Customer soylent" interface=soylent
add address=198.51.100.65/32 comment="VRRP 105 on soylent" interface=soylent-vrrp105
add address=198.51.100.98/28 comment="Customer cyberdyne" interface=cyberdyne
add address=198.51.100.97/32 comment="VRRP 106 on cyberdyne" interface=cyberdyne-vrrp106
add address=198.51.100.114/29 comment="Customer tyrell" interface=tyrell
add address=198.51.100.113/32 comment="VRRP 107 on tyrell" interface=tyrell-vrrp107
add address=198.51.100.122/29 comment="Customer wonka" interface=wonka
add address=198.51.100.121/32 comment="VRRP 108 on wonka" interface=wonka-vrrp108
/ipv6 address
add address=2001:db8:100::1/128 advertise=no comment="Router ID, iBGP, and the anycast resolver" interface=loopback
add address=2001:db8:ffff:1::2/64 advertise=no comment="Transit A" interface=transit-a
add address=2001:db8:ffff::140/64 advertise=no comment="Example IX" interface=ix
add address=2001:db8:100:1::2/64 advertise=yes comment="Customer acme" interface=acme
add address=2001:db8:100:2::2/64 advertise=yes comment="Customer globex" interface=globex
add address=2001:db8:100:3::2/64 advertise=yes comment="Customer initech" interface=initech
add address=2001:db8:100:5::2/64 advertise=yes comment="Customer soylent" interface=soylent
add address=2001:db8:100:6::2/64 advertise=yes comment="Customer cyberdyne" interface=cyberdyne
add address=2001:db8:100:8::2/64 advertise=yes comment="Customer wonka" interface=wonka
/ip dns
set allow-remote-requests=yes servers="10.0.20.53,10.0.20.54"
/ip firewall address-list
add address=10.0.99.0/24 list=admin
add address=10.1.99.0/24 list=admin
add address=10.254.2.0/24 list=admin
add address=10.0.20.30 list=monitoring
add address=10.0.20.31 list=monitoring
add address=203.0.113.1 list=bgp-neighbors
add address=198.51.100.2 list=bgp-neighbors
add address=198.51.100.3 list=bgp-neighbors
add address=203.0.113.129 list=bgp-neighbors
add address=203.0.113.130 list=bgp-neighbors
add address=203.0.113.150 list=bgp-neighbors
add address=203.0.113.151 list=bgp-neighbors
add address=203.0.113.152 list=bgp-neighbors
add address=198.51.100.20 list=bgp-neighbors
add address=203.0.113.10 list=tunnel-peers
add address=198.51.100.0/24 list=ours
add address=192.0.2.0/24 list=acme-v4
add address=198.51.100.0/24 list=bgp-networks-v4
/ipv6 firewall address-list
add address=2001:db8:ffff:1::1 list=bgp-neighbors
add address=2001:db8:100::2 list=bgp-neighbors
add address=2001:db8:100::3 list=bgp-neighbors
add address=2001:db8:ffff::1 list=bgp-neighbors
add address=2001:db8:ffff::2 list=bgp-neighbors
add address=2001:db8:ffff::150 list=bgp-neighbors
add address=2001:db8:ffff::151 list=bgp-neighbors
add address=2001:db8:ffff::152 list=bgp-neighbors
add address=2001:db8:100:1::4 list=bgp-neighbors
add address=2001:db8:100:2::4 list=bgp-neighbors
add address=2001:db8:100:6::4 list=bgp-neighbors
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
add action=accept chain=input comment=WireGuard dst-port=51820 protocol=udp
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
add action=drop chain=forward comment="Remote desktop and telnet from transit-a" dst-port="23,3389,5900" in-interface=transit-a protocol=tcp
add action=drop chain=forward comment="Remote desktop and telnet from ix" dst-port="23,3389,5900" in-interface=ix protocol=tcp
/ip firewall nat
add action=masquerade chain=srcnat comment="Management out through transit-a" out-interface=transit-a src-address=10.0.0.0/8
add action=masquerade chain=srcnat comment="Management out through ix" out-interface=ix src-address=10.0.0.0/8
/ipv6 firewall filter
add action=accept chain=input comment=Replies connection-state="established,related"
add action=drop chain=input comment=Invalid connection-state=invalid
add action=accept chain=input comment=Ping protocol=icmpv6
add action=accept chain=input comment=BGP dst-port=179 protocol=tcp src-address-list=bgp-neighbors
add action=accept chain=input comment=BFD dst-port=3784-3785 protocol=udp
add action=accept chain=input comment=OSPF protocol=ospf
add action=accept chain=input comment=VRRP protocol=vrrp
add action=accept chain=input comment=WireGuard dst-port=51820 protocol=udp
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
add action=drop chain=forward comment="Remote desktop and telnet from transit-a" dst-port="23,3389,5900" in-interface=transit-a protocol=tcp
add action=drop chain=forward comment="Remote desktop and telnet from ix" dst-port="23,3389,5900" in-interface=ix protocol=tcp
/ip firewall service-port
set ftp disabled=no
set tftp disabled=yes
set irc disabled=yes
set h323 disabled=yes
set sip disabled=yes
set pptp disabled=yes
set rtsp disabled=yes
/interface ethernet switch rule
add comment="transit-a: drop source 198.51.100.0/24" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=198.51.100.0/255.255.255.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 127.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=127.0.0.0/255.0.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 169.254.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=169.254.0.0/255.255.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 0.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=0.0.0.0/255.0.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 10.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=10.0.0.0/255.0.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 172.16.0.0/12" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=172.16.0.0/255.240.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 192.168.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=192.168.0.0/255.255.0.0 switch=switch1 vlan-id=300
add comment="ix: drop source 198.51.100.0/24" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=198.51.100.0/255.255.255.0 switch=switch1 vlan-id=200
add comment="ix: drop source 127.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=127.0.0.0/255.0.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 169.254.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=169.254.0.0/255.255.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 0.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=0.0.0.0/255.0.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 10.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=10.0.0.0/255.0.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 172.16.0.0/12" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=172.16.0.0/255.240.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 192.168.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-1 src-address=192.168.0.0/255.255.0.0 switch=switch1 vlan-id=200
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
add comment="transit-a: drop source 198.51.100.0/24" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=198.51.100.0/255.255.255.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 127.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=127.0.0.0/255.0.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 169.254.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=169.254.0.0/255.255.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 0.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=0.0.0.0/255.0.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 10.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=10.0.0.0/255.0.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 172.16.0.0/12" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=172.16.0.0/255.240.0.0 switch=switch1 vlan-id=300
add comment="transit-a: drop source 192.168.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=192.168.0.0/255.255.0.0 switch=switch1 vlan-id=300
add comment="ix: drop source 198.51.100.0/24" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=198.51.100.0/255.255.255.0 switch=switch1 vlan-id=200
add comment="ix: drop source 127.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=127.0.0.0/255.0.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 169.254.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=169.254.0.0/255.255.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 0.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=0.0.0.0/255.0.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 10.0.0.0/8" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=10.0.0.0/255.0.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 172.16.0.0/12" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=172.16.0.0/255.240.0.0 switch=switch1 vlan-id=200
add comment="ix: drop source 192.168.0.0/16" mac-protocol=ip new-dst-ports="" ports=sfp28-2 src-address=192.168.0.0/255.255.0.0 switch=switch1 vlan-id=200
add comment="UDP fragments to 198.51.100.16/28" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=0 switch=switch1
add comment="UDP to 198.51.100.16/28 from qotd" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=17 switch=switch1
add comment="UDP to 198.51.100.16/28 from chargen" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=19 switch=switch1
add comment="UDP to 198.51.100.16/28 from dns, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=0-52 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.16/28 from dns, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=54-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.16/28 from portmap" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=111 switch=switch1
add comment="UDP to 198.51.100.16/28 from ntp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=0-122 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.16/28 from ntp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=124-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.16/28 from netbios" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=137 switch=switch1
add comment="UDP to 198.51.100.16/28 from snmp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=0-160 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.16/28 from snmp, to a port below 1024" dst-address=198.51.100.16/255.255.255.240 dst-port=162-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.16/28 from cldap" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=389 switch=switch1
add comment="UDP to 198.51.100.16/28 from slp" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=427 switch=switch1
add comment="UDP to 198.51.100.16/28 from rip" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=520 switch=switch1
add comment="UDP to 198.51.100.16/28 from ms-sql" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=1434 switch=switch1
add comment="UDP to 198.51.100.16/28 from ssdp" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=1900 switch=switch1
add comment="UDP to 198.51.100.16/28 from ard" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=3283 switch=switch1
add comment="UDP to 198.51.100.16/28 from ws-discovery" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=3702 switch=switch1
add comment="UDP to 198.51.100.16/28 from mdns" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=5353 switch=switch1
add comment="UDP to 198.51.100.16/28 from coap" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=5683 switch=switch1
add comment="UDP to 198.51.100.16/28 from ubiquiti" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=10001 switch=switch1
add comment="UDP to 198.51.100.16/28 from memcached" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=11211 switch=switch1
add comment="UDP to 198.51.100.16/28 from dvr" dst-address=198.51.100.16/255.255.255.240 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=37810 switch=switch1
add comment="UDP fragments to 198.51.100.64/27" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=0 switch=switch1
add comment="UDP to 198.51.100.64/27 from qotd" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=17 switch=switch1
add comment="UDP to 198.51.100.64/27 from chargen" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=19 switch=switch1
add comment="UDP to 198.51.100.64/27 from dns, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=0-52 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.64/27 from dns, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=54-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=53 switch=switch1
add comment="UDP to 198.51.100.64/27 from portmap" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=111 switch=switch1
add comment="UDP to 198.51.100.64/27 from ntp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=0-122 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.64/27 from ntp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=124-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=123 switch=switch1
add comment="UDP to 198.51.100.64/27 from netbios" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=137 switch=switch1
add comment="UDP to 198.51.100.64/27 from snmp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=0-160 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.64/27 from snmp, to a port below 1024" dst-address=198.51.100.64/255.255.255.224 dst-port=162-1023 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=161 switch=switch1
add comment="UDP to 198.51.100.64/27 from cldap" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=389 switch=switch1
add comment="UDP to 198.51.100.64/27 from slp" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=427 switch=switch1
add comment="UDP to 198.51.100.64/27 from rip" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=520 switch=switch1
add comment="UDP to 198.51.100.64/27 from ms-sql" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=1434 switch=switch1
add comment="UDP to 198.51.100.64/27 from ssdp" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=1900 switch=switch1
add comment="UDP to 198.51.100.64/27 from ard" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=3283 switch=switch1
add comment="UDP to 198.51.100.64/27 from ws-discovery" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=3702 switch=switch1
add comment="UDP to 198.51.100.64/27 from mdns" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=5353 switch=switch1
add comment="UDP to 198.51.100.64/27 from coap" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=5683 switch=switch1
add comment="UDP to 198.51.100.64/27 from ubiquiti" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=10001 switch=switch1
add comment="UDP to 198.51.100.64/27 from memcached" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=11211 switch=switch1
add comment="UDP to 198.51.100.64/27 from dvr" dst-address=198.51.100.64/255.255.255.224 mac-protocol=ip new-dst-ports="" ports=sfp28-2 protocol=udp src-port=37810 switch=switch1
/ip route
add blackhole comment=Originate dst-address=198.51.100.0/24
add comment="Out-of-band exit" dst-address=0.0.0.0/0 gateway=10.9.0.254 routing-table=oob
add comment="The monitoring network, over its VPN" dst-address=10.50.0.0/24 gateway=wg-noc
add comment="Routed to vandelay" dst-address=198.51.100.192/28 gateway=198.51.100.60
/ipv6 route
add blackhole comment=Originate dst-address=2001:db8:100::/48
/routing rpki
add address=10.0.20.80 comment="Validator 1" group=rpki port=323
add address=10.0.20.81 comment="Validator 2" group=rpki port=8282
/routing bgp instance
add as=64500 name=default router-id=198.51.100.1
/routing filter rule
add chain=CUSTOMER-ACME-IN-V4 comment="Blackhole, asked by the neighbor" rule="if (dst in acme-v4 && bgp-large-communities includes 64500:666:0) { set blackhole yes; accept }"
add chain=CUSTOMER-ACME-IN-V4 rule="jump SANITY-V4"
add chain=CUSTOMER-ACME-IN-V4 comment="Learned from AS65537" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:1:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:2:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:3:[0-9]+\$\"; append bgp-large-communities 64500:1:4,64500:2:1,64500:3:65537"
add chain=CUSTOMER-ACME-IN-V4 comment="Their space, acme-v4" rule="if (dst in acme-v4) { set bgp-local-pref 300; accept }"
add chain=CUSTOMER-ACME-IN-V4 comment="Nothing else" rule=reject
add chain=CUSTOMER-ACME-IN-V6 comment="Blackhole, asked by the neighbor" rule="if (dst in acme-v6 && bgp-large-communities includes 64500:666:0) { set blackhole yes; accept }"
add chain=CUSTOMER-ACME-IN-V6 rule="jump SANITY-V6"
add chain=CUSTOMER-ACME-IN-V6 comment="Learned from AS65537" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:1:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:2:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:3:[0-9]+\$\"; append bgp-large-communities 64500:1:4,64500:2:1,64500:3:65537"
add chain=CUSTOMER-ACME-IN-V6 comment="Their space, acme-v6" rule="if (dst in acme-v6) { set bgp-local-pref 300; accept }"
add chain=CUSTOMER-ACME-IN-V6 comment="Nothing else" rule=reject
add chain=CUSTOMER-CYBERDYNE-IN-V6 comment="Blackhole, asked by the neighbor" rule="if (dst in cyberdyne-v6 && bgp-large-communities includes 64500:666:0) { set blackhole yes; accept }"
add chain=CUSTOMER-CYBERDYNE-IN-V6 rule="jump SANITY-V6"
add chain=CUSTOMER-CYBERDYNE-IN-V6 comment="Learned from AS65540" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:1:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:2:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:3:[0-9]+\$\"; append bgp-large-communities 64500:1:4,64500:2:1,64500:3:65540"
add chain=CUSTOMER-CYBERDYNE-IN-V6 comment="Their space, cyberdyne-v6" rule="if (dst in cyberdyne-v6) { set bgp-local-pref 300; accept }"
add chain=CUSTOMER-CYBERDYNE-IN-V6 comment="Nothing else" rule=reject
add chain=CUSTOMER-GLOBEX-IN-V6 comment="Blackhole, asked by the neighbor" rule="if (dst in globex-v6 && bgp-large-communities includes 64500:666:0) { set blackhole yes; accept }"
add chain=CUSTOMER-GLOBEX-IN-V6 rule="jump SANITY-V6"
add chain=CUSTOMER-GLOBEX-IN-V6 comment="Learned from AS65538" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:1:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:2:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:3:[0-9]+\$\"; append bgp-large-communities 64500:1:4,64500:2:1,64500:3:65538"
add chain=CUSTOMER-GLOBEX-IN-V6 comment="Their space, globex-v6" rule="if (dst in globex-v6) { set bgp-local-pref 300; accept }"
add chain=CUSTOMER-GLOBEX-IN-V6 comment="Nothing else" rule=reject
add chain=CUSTOMER-OUT-V4 comment="The full table" rule=accept
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
add chain=IX-RS-IN-V4 rule="jump SANITY-V4"
add chain=IX-RS-IN-V4 comment="Learned from AS64504" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:2,64500:2:1,64500:3:64504"
add chain=IX-RS-IN-V4 rule="set bgp-local-pref 200"
add chain=IX-RS-IN-V4 rule=accept
add chain=IX-RS-IN-V6 rule="jump SANITY-V6"
add chain=IX-RS-IN-V6 comment="Learned from AS64504" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:2,64500:2:1,64500:3:64504"
add chain=IX-RS-IN-V6 rule="set bgp-local-pref 200"
add chain=IX-RS-IN-V6 rule=accept
add chain=IX-RS-OUT-V4 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=IX-RS-OUT-V4 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=IX-RS-OUT-V4 comment="Asked not to be announced to AS64504" rule="if (bgp-large-communities includes 64500:100:64504) { reject }"
add chain=IX-RS-OUT-V4 comment="Asked to prepend once to AS64504" rule="if (bgp-large-communities includes 64500:101:64504) { set bgp-path-prepend 1 }"
add chain=IX-RS-OUT-V4 comment="Asked to prepend twice to AS64504" rule="if (bgp-large-communities includes 64500:102:64504) { set bgp-path-prepend 2 }"
add chain=IX-RS-OUT-V4 comment="Asked to prepend three times to AS64504" rule="if (bgp-large-communities includes 64500:103:64504) { set bgp-path-prepend 3 }"
add chain=IX-RS-OUT-V4 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=IX-RS-OUT-V4 comment="Our IPv4" rule="if (dst==198.51.100.0/24) { accept }"
add chain=IX-RS-OUT-V4 comment="Customer space acme-v4" rule="if (dst in acme-v4) { accept }"
add chain=IX-RS-OUT-V4 comment="Nothing else leaves" rule=reject
add chain=IX-RS-OUT-V6 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=IX-RS-OUT-V6 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=IX-RS-OUT-V6 comment="Asked not to be announced to AS64504" rule="if (bgp-large-communities includes 64500:100:64504) { reject }"
add chain=IX-RS-OUT-V6 comment="Asked to prepend once to AS64504" rule="if (bgp-large-communities includes 64500:101:64504) { set bgp-path-prepend 1 }"
add chain=IX-RS-OUT-V6 comment="Asked to prepend twice to AS64504" rule="if (bgp-large-communities includes 64500:102:64504) { set bgp-path-prepend 2 }"
add chain=IX-RS-OUT-V6 comment="Asked to prepend three times to AS64504" rule="if (bgp-large-communities includes 64500:103:64504) { set bgp-path-prepend 3 }"
add chain=IX-RS-OUT-V6 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=IX-RS-OUT-V6 comment="Our IPv6" rule="if (dst==2001:db8:100::/48) { accept }"
add chain=IX-RS-OUT-V6 comment="Customer space acme-v6" rule="if (dst in acme-v6) { accept }"
add chain=IX-RS-OUT-V6 comment="Customer space globex-v6" rule="if (dst in globex-v6) { accept }"
add chain=IX-RS-OUT-V6 comment="Customer space cyberdyne-v6" rule="if (dst in cyberdyne-v6) { accept }"
add chain=IX-RS-OUT-V6 comment="Customer space oscorp-v6" rule="if (dst in oscorp-v6) { accept }"
add chain=IX-RS-OUT-V6 comment="Nothing else leaves" rule=reject
add chain=PEER-CDN-B-IN-V4 rule="jump SANITY-V4"
add chain=PEER-CDN-B-IN-V4 comment="Learned from AS64506" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:3,64500:2:1,64500:3:64506"
add chain=PEER-CDN-B-IN-V4 comment="Its own and its customers' routes" rule="if (bgp-path-len<3) { set bgp-med 0 }"
add chain=PEER-CDN-B-IN-V4 rule="set bgp-local-pref 250"
add chain=PEER-CDN-B-IN-V4 rule=accept
add chain=PEER-CDN-B-IN-V6 rule="jump SANITY-V6"
add chain=PEER-CDN-B-IN-V6 comment="Learned from AS64506" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:3,64500:2:1,64500:3:64506"
add chain=PEER-CDN-B-IN-V6 comment="Its own and its customers' routes" rule="if (bgp-path-len<3) { set bgp-med 0 }"
add chain=PEER-CDN-B-IN-V6 rule="set bgp-local-pref 250"
add chain=PEER-CDN-B-IN-V6 rule=accept
add chain=PEER-CDN-B-OUT-V4 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=PEER-CDN-B-OUT-V4 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=PEER-CDN-B-OUT-V4 comment="Asked not to be announced to AS64506" rule="if (bgp-large-communities includes 64500:100:64506) { reject }"
add chain=PEER-CDN-B-OUT-V4 comment="Asked to prepend once to AS64506" rule="if (bgp-large-communities includes 64500:101:64506) { set bgp-path-prepend 1 }"
add chain=PEER-CDN-B-OUT-V4 comment="Asked to prepend twice to AS64506" rule="if (bgp-large-communities includes 64500:102:64506) { set bgp-path-prepend 2 }"
add chain=PEER-CDN-B-OUT-V4 comment="Asked to prepend three times to AS64506" rule="if (bgp-large-communities includes 64500:103:64506) { set bgp-path-prepend 3 }"
add chain=PEER-CDN-B-OUT-V4 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=PEER-CDN-B-OUT-V4 comment="Our IPv4" rule="if (dst==198.51.100.0/24) { accept }"
add chain=PEER-CDN-B-OUT-V4 comment="Customer space acme-v4" rule="if (dst in acme-v4) { accept }"
add chain=PEER-CDN-B-OUT-V4 comment="Nothing else leaves" rule=reject
add chain=PEER-CDN-B-OUT-V6 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=PEER-CDN-B-OUT-V6 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=PEER-CDN-B-OUT-V6 comment="Asked not to be announced to AS64506" rule="if (bgp-large-communities includes 64500:100:64506) { reject }"
add chain=PEER-CDN-B-OUT-V6 comment="Asked to prepend once to AS64506" rule="if (bgp-large-communities includes 64500:101:64506) { set bgp-path-prepend 1 }"
add chain=PEER-CDN-B-OUT-V6 comment="Asked to prepend twice to AS64506" rule="if (bgp-large-communities includes 64500:102:64506) { set bgp-path-prepend 2 }"
add chain=PEER-CDN-B-OUT-V6 comment="Asked to prepend three times to AS64506" rule="if (bgp-large-communities includes 64500:103:64506) { set bgp-path-prepend 3 }"
add chain=PEER-CDN-B-OUT-V6 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=PEER-CDN-B-OUT-V6 comment="Our IPv6" rule="if (dst==2001:db8:100::/48) { accept }"
add chain=PEER-CDN-B-OUT-V6 comment="Customer space acme-v6" rule="if (dst in acme-v6) { accept }"
add chain=PEER-CDN-B-OUT-V6 comment="Customer space globex-v6" rule="if (dst in globex-v6) { accept }"
add chain=PEER-CDN-B-OUT-V6 comment="Customer space cyberdyne-v6" rule="if (dst in cyberdyne-v6) { accept }"
add chain=PEER-CDN-B-OUT-V6 comment="Customer space oscorp-v6" rule="if (dst in oscorp-v6) { accept }"
add chain=PEER-CDN-B-OUT-V6 comment="Nothing else leaves" rule=reject
add chain=PEER-CONTENT-A-IN-V4 rule="jump SANITY-V4"
add chain=PEER-CONTENT-A-IN-V4 comment="Learned from AS64505" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:3,64500:2:1,64500:3:64505"
add chain=PEER-CONTENT-A-IN-V4 comment="Its own and its customers' routes" rule="if (bgp-path-len<3) { set bgp-med 0 }"
add chain=PEER-CONTENT-A-IN-V4 rule="set bgp-local-pref 250"
add chain=PEER-CONTENT-A-IN-V4 rule=accept
add chain=PEER-CONTENT-A-IN-V6 rule="jump SANITY-V6"
add chain=PEER-CONTENT-A-IN-V6 comment="Learned from AS64505" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:3,64500:2:1,64500:3:64505"
add chain=PEER-CONTENT-A-IN-V6 comment="Its own and its customers' routes" rule="if (bgp-path-len<3) { set bgp-med 0 }"
add chain=PEER-CONTENT-A-IN-V6 rule="set bgp-local-pref 250"
add chain=PEER-CONTENT-A-IN-V6 rule=accept
add chain=PEER-CONTENT-A-OUT-V4 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Asked not to be announced to AS64505" rule="if (bgp-large-communities includes 64500:100:64505) { reject }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Asked to prepend once to AS64505" rule="if (bgp-large-communities includes 64500:101:64505) { set bgp-path-prepend 1 }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Asked to prepend twice to AS64505" rule="if (bgp-large-communities includes 64500:102:64505) { set bgp-path-prepend 2 }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Asked to prepend three times to AS64505" rule="if (bgp-large-communities includes 64500:103:64505) { set bgp-path-prepend 3 }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=PEER-CONTENT-A-OUT-V4 comment="Our IPv4" rule="if (dst==198.51.100.0/24) { accept }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Customer space acme-v4" rule="if (dst in acme-v4) { accept }"
add chain=PEER-CONTENT-A-OUT-V4 comment="Nothing else leaves" rule=reject
add chain=PEER-CONTENT-A-OUT-V6 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Asked not to be announced to AS64505" rule="if (bgp-large-communities includes 64500:100:64505) { reject }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Asked to prepend once to AS64505" rule="if (bgp-large-communities includes 64500:101:64505) { set bgp-path-prepend 1 }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Asked to prepend twice to AS64505" rule="if (bgp-large-communities includes 64500:102:64505) { set bgp-path-prepend 2 }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Asked to prepend three times to AS64505" rule="if (bgp-large-communities includes 64500:103:64505) { set bgp-path-prepend 3 }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=PEER-CONTENT-A-OUT-V6 comment="Our IPv6" rule="if (dst==2001:db8:100::/48) { accept }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Customer space acme-v6" rule="if (dst in acme-v6) { accept }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Customer space globex-v6" rule="if (dst in globex-v6) { accept }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Customer space cyberdyne-v6" rule="if (dst in cyberdyne-v6) { accept }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Customer space oscorp-v6" rule="if (dst in oscorp-v6) { accept }"
add chain=PEER-CONTENT-A-OUT-V6 comment="Nothing else leaves" rule=reject
add chain=PEER-ISP-C-IN-V4 rule="jump SANITY-V4"
add chain=PEER-ISP-C-IN-V4 comment="Learned from AS65536" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:3,64500:2:1,64500:3:65536"
add chain=PEER-ISP-C-IN-V4 comment="Its own and its customers' routes" rule="if (bgp-path-len<3) { set bgp-med 0 }"
add chain=PEER-ISP-C-IN-V4 rule="set bgp-local-pref 250"
add chain=PEER-ISP-C-IN-V4 rule=accept
add chain=PEER-ISP-C-IN-V6 rule="jump SANITY-V6"
add chain=PEER-ISP-C-IN-V6 comment="Learned from AS65536" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:3,64500:2:1,64500:3:65536"
add chain=PEER-ISP-C-IN-V6 comment="Its own and its customers' routes" rule="if (bgp-path-len<3) { set bgp-med 0 }"
add chain=PEER-ISP-C-IN-V6 rule="set bgp-local-pref 250"
add chain=PEER-ISP-C-IN-V6 rule=accept
add chain=PEER-ISP-C-OUT-V4 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=PEER-ISP-C-OUT-V4 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=PEER-ISP-C-OUT-V4 comment="Asked not to be announced to AS65536" rule="if (bgp-large-communities includes 64500:100:65536) { reject }"
add chain=PEER-ISP-C-OUT-V4 comment="Asked to prepend once to AS65536" rule="if (bgp-large-communities includes 64500:101:65536) { set bgp-path-prepend 1 }"
add chain=PEER-ISP-C-OUT-V4 comment="Asked to prepend twice to AS65536" rule="if (bgp-large-communities includes 64500:102:65536) { set bgp-path-prepend 2 }"
add chain=PEER-ISP-C-OUT-V4 comment="Asked to prepend three times to AS65536" rule="if (bgp-large-communities includes 64500:103:65536) { set bgp-path-prepend 3 }"
add chain=PEER-ISP-C-OUT-V4 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=PEER-ISP-C-OUT-V4 comment="Our IPv4" rule="if (dst==198.51.100.0/24) { accept }"
add chain=PEER-ISP-C-OUT-V4 comment="Customer space acme-v4" rule="if (dst in acme-v4) { accept }"
add chain=PEER-ISP-C-OUT-V4 comment="Nothing else leaves" rule=reject
add chain=PEER-ISP-C-OUT-V6 comment="Blackholed here, never announced" rule="if (bgp-large-communities includes 64500:666:0) { reject }"
add chain=PEER-ISP-C-OUT-V6 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=PEER-ISP-C-OUT-V6 comment="Asked not to be announced to AS65536" rule="if (bgp-large-communities includes 64500:100:65536) { reject }"
add chain=PEER-ISP-C-OUT-V6 comment="Asked to prepend once to AS65536" rule="if (bgp-large-communities includes 64500:101:65536) { set bgp-path-prepend 1 }"
add chain=PEER-ISP-C-OUT-V6 comment="Asked to prepend twice to AS65536" rule="if (bgp-large-communities includes 64500:102:65536) { set bgp-path-prepend 2 }"
add chain=PEER-ISP-C-OUT-V6 comment="Asked to prepend three times to AS65536" rule="if (bgp-large-communities includes 64500:103:65536) { set bgp-path-prepend 3 }"
add chain=PEER-ISP-C-OUT-V6 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=PEER-ISP-C-OUT-V6 comment="Our IPv6" rule="if (dst==2001:db8:100::/48) { accept }"
add chain=PEER-ISP-C-OUT-V6 comment="Customer space acme-v6" rule="if (dst in acme-v6) { accept }"
add chain=PEER-ISP-C-OUT-V6 comment="Customer space globex-v6" rule="if (dst in globex-v6) { accept }"
add chain=PEER-ISP-C-OUT-V6 comment="Customer space cyberdyne-v6" rule="if (dst in cyberdyne-v6) { accept }"
add chain=PEER-ISP-C-OUT-V6 comment="Customer space oscorp-v6" rule="if (dst in oscorp-v6) { accept }"
add chain=PEER-ISP-C-OUT-V6 comment="Nothing else leaves" rule=reject
add chain=SANITY-V4 comment="IPv4 shorter than /8" rule="if (dst-len<8) { reject }"
add chain=SANITY-V4 comment="IPv4 longer than /24" rule="if (dst-len>24) { reject }"
add chain=SANITY-V4 comment="RPKI invalid" rule="rpki-verify rpki; if (rpki invalid) { reject }"
add chain=SANITY-V6 comment="IPv6 shorter than /16" rule="if (dst-len<16) { reject }"
add chain=SANITY-V6 comment="IPv6 longer than /48" rule="if (dst-len>48) { reject }"
add chain=SANITY-V6 comment="RPKI invalid" rule="rpki-verify rpki; if (rpki invalid) { reject }"
add chain=TRANSIT-A-IN-V4 rule="jump SANITY-V4"
add chain=TRANSIT-A-IN-V4 comment="Learned from AS64501" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:1,64500:2:1,64500:3:64501"
add chain=TRANSIT-A-IN-V4 rule="set bgp-local-pref 100"
add chain=TRANSIT-A-IN-V4 rule=accept
add chain=TRANSIT-A-IN-V6 rule="jump SANITY-V6"
add chain=TRANSIT-A-IN-V6 comment="Learned from AS64501" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; append bgp-large-communities 64500:1:1,64500:2:1,64500:3:64501"
add chain=TRANSIT-A-IN-V6 rule="set bgp-local-pref 100"
add chain=TRANSIT-A-IN-V6 rule=accept
add chain=TRANSIT-A-OUT-V4 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=TRANSIT-A-OUT-V4 comment="Asked not to be announced to AS64501" rule="if (bgp-large-communities includes 64500:100:64501) { reject }"
add chain=TRANSIT-A-OUT-V4 comment="Blackhole passed on to AS64501" rule="if (bgp-large-communities includes 64500:666:0) { delete bgp-communities regexp \"^64500:[0-9]+\$\"; append bgp-communities 64501:666; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; accept }"
add chain=TRANSIT-A-OUT-V4 comment="Asked to prepend once to AS64501" rule="if (bgp-large-communities includes 64500:101:64501) { set bgp-path-prepend 1 }"
add chain=TRANSIT-A-OUT-V4 comment="Asked to prepend twice to AS64501" rule="if (bgp-large-communities includes 64500:102:64501) { set bgp-path-prepend 2 }"
add chain=TRANSIT-A-OUT-V4 comment="Asked to prepend three times to AS64501" rule="if (bgp-large-communities includes 64500:103:64501) { set bgp-path-prepend 3 }"
add chain=TRANSIT-A-OUT-V4 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=TRANSIT-A-OUT-V4 comment="Our IPv4" rule="if (dst==198.51.100.0/24) { accept }"
add chain=TRANSIT-A-OUT-V4 comment="Customer space acme-v4" rule="if (dst in acme-v4) { accept }"
add chain=TRANSIT-A-OUT-V4 comment="Nothing else leaves" rule=reject
add chain=TRANSIT-A-OUT-V6 comment="Asked not to be announced anywhere" rule="if (bgp-large-communities includes 64500:100:0) { reject }"
add chain=TRANSIT-A-OUT-V6 comment="Asked not to be announced to AS64501" rule="if (bgp-large-communities includes 64500:100:64501) { reject }"
add chain=TRANSIT-A-OUT-V6 comment="Blackhole passed on to AS64501" rule="if (bgp-large-communities includes 64500:666:0) { delete bgp-communities regexp \"^64500:[0-9]+\$\"; append bgp-communities 64501:666; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\"; accept }"
add chain=TRANSIT-A-OUT-V6 comment="Asked to prepend once to AS64501" rule="if (bgp-large-communities includes 64500:101:64501) { set bgp-path-prepend 1 }"
add chain=TRANSIT-A-OUT-V6 comment="Asked to prepend twice to AS64501" rule="if (bgp-large-communities includes 64500:102:64501) { set bgp-path-prepend 2 }"
add chain=TRANSIT-A-OUT-V6 comment="Asked to prepend three times to AS64501" rule="if (bgp-large-communities includes 64500:103:64501) { set bgp-path-prepend 3 }"
add chain=TRANSIT-A-OUT-V6 comment="Our communities stay inside our network" rule="delete bgp-communities regexp \"^64500:[0-9]+\$\"; delete bgp-large-communities regexp \"^64500:[0-9]+:[0-9]+\$\""
add chain=TRANSIT-A-OUT-V6 comment="Our IPv6" rule="if (dst==2001:db8:100::/48) { accept }"
add chain=TRANSIT-A-OUT-V6 comment="Customer space acme-v6" rule="if (dst in acme-v6) { accept }"
add chain=TRANSIT-A-OUT-V6 comment="Customer space globex-v6" rule="if (dst in globex-v6) { accept }"
add chain=TRANSIT-A-OUT-V6 comment="Customer space cyberdyne-v6" rule="if (dst in cyberdyne-v6) { accept }"
add chain=TRANSIT-A-OUT-V6 comment="Customer space oscorp-v6" rule="if (dst in oscorp-v6) { accept }"
add chain=TRANSIT-A-OUT-V6 comment="Nothing else leaves" rule=reject
/routing bgp connection
add as=64500 input.filter=TRANSIT-A-IN-V4 instance=default input.limit-process-routes-ipv4=1200000 local.role=ebgp-customer name=transit-a-v4 output.filter-chain=TRANSIT-A-OUT-V4 output.network=bgp-networks-v4 remote.address=203.0.113.1/32 remote.as=64501 tcp-md5-key="<secret:TRANSIT_A_BGP_PASSWORD>" use-bfd=yes
add as=64500 input.filter=TRANSIT-A-IN-V6 instance=default input.limit-process-routes-ipv6=250000 local.role=ebgp-customer name=transit-a-v6 output.filter-chain=TRANSIT-A-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:ffff:1::1/128 remote.as=64501 tcp-md5-key="<secret:TRANSIT_A_BGP_PASSWORD>" use-bfd=yes
add as=64500 input.filter=IBGP-IN-V4 instance=default local.address=198.51.100.1 local.role=ibgp name=edge-a2-v4 output.filter-chain=IBGP-OUT-V4 output.network=bgp-networks-v4 remote.address=198.51.100.2/32 remote.as=64500
add as=64500 input.filter=IBGP-IN-V6 instance=default local.address=2001:db8:100::1 local.role=ibgp name=edge-a2-v6 output.filter-chain=IBGP-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100::2/128 remote.as=64500
add as=64500 input.filter=IBGP-IN-V4 instance=default local.address=198.51.100.1 local.role=ibgp name=edge-b1-v4 output.filter-chain=IBGP-OUT-V4 output.network=bgp-networks-v4 remote.address=198.51.100.3/32 remote.as=64500
add as=64500 input.filter=IBGP-IN-V6 instance=default local.address=2001:db8:100::1 local.role=ibgp name=edge-b1-v6 output.filter-chain=IBGP-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100::3/128 remote.as=64500
add as=64500 input.filter=IX-RS-IN-V4 instance=default input.limit-process-routes-ipv4=150000 local.role=ebgp-rs-client name=rs1-v4 output.filter-chain=IX-RS-OUT-V4 output.network=bgp-networks-v4 remote.address=203.0.113.129/32 remote.as=64504
add as=64500 input.filter=IX-RS-IN-V6 instance=default input.limit-process-routes-ipv6=150000 local.role=ebgp-rs-client name=rs1-v6 output.filter-chain=IX-RS-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:ffff::1/128 remote.as=64504
add as=64500 input.filter=IX-RS-IN-V4 instance=default input.limit-process-routes-ipv4=150000 local.role=ebgp-rs-client name=rs2-v4 output.filter-chain=IX-RS-OUT-V4 output.network=bgp-networks-v4 remote.address=203.0.113.130/32 remote.as=64504
add as=64500 input.filter=IX-RS-IN-V6 instance=default input.limit-process-routes-ipv6=150000 local.role=ebgp-rs-client name=rs2-v6 output.filter-chain=IX-RS-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:ffff::2/128 remote.as=64504
add as=64500 input.filter=PEER-CONTENT-A-IN-V4 instance=default input.limit-process-routes-ipv4=2000 local.role=ebgp-peer name=content-a-v4 output.filter-chain=PEER-CONTENT-A-OUT-V4 output.network=bgp-networks-v4 remote.address=203.0.113.150/32 remote.as=64505
add as=64500 input.filter=PEER-CONTENT-A-IN-V6 instance=default input.limit-process-routes-ipv6=1000 local.role=ebgp-peer name=content-a-v6 output.filter-chain=PEER-CONTENT-A-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:ffff::150/128 remote.as=64505
add as=64500 input.filter=PEER-CDN-B-IN-V4 instance=default input.limit-process-routes-ipv4=500 local.role=ebgp-peer name=cdn-b-v4 output.filter-chain=PEER-CDN-B-OUT-V4 output.network=bgp-networks-v4 remote.address=203.0.113.151/32 remote.as=64506
add as=64500 input.filter=PEER-CDN-B-IN-V6 instance=default input.limit-process-routes-ipv6=500 local.role=ebgp-peer name=cdn-b-v6 output.filter-chain=PEER-CDN-B-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:ffff::151/128 remote.as=64506
add as=64500 input.filter=PEER-ISP-C-IN-V4 instance=default input.limit-process-routes-ipv4=300 local.role=ebgp-peer name=isp-c-v4 output.filter-chain=PEER-ISP-C-OUT-V4 output.network=bgp-networks-v4 remote.address=203.0.113.152/32 remote.as=65536
add as=64500 input.filter=PEER-ISP-C-IN-V6 instance=default input.limit-process-routes-ipv6=100 local.role=ebgp-peer name=isp-c-v6 output.filter-chain=PEER-ISP-C-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:ffff::152/128 remote.as=65536
add as=64500 input.filter=CUSTOMER-ACME-IN-V4 instance=default input.limit-process-routes-ipv4=20 local.role=ebgp-provider name=acme-v4 output.filter-chain=CUSTOMER-OUT-V4 output.network=bgp-networks-v4 remote.address=198.51.100.20/32 remote.as=65537
add as=64500 input.filter=CUSTOMER-ACME-IN-V6 instance=default input.limit-process-routes-ipv6=20 local.role=ebgp-provider name=acme-v6 output.filter-chain=CUSTOMER-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100:1::4/128 remote.as=65537
add as=64500 input.filter=CUSTOMER-GLOBEX-IN-V6 instance=default input.limit-process-routes-ipv6=10 local.role=ebgp-provider name=globex-v6 output.filter-chain=CUSTOMER-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100:2::4/128 remote.as=65538
add as=64500 input.filter=CUSTOMER-CYBERDYNE-IN-V6 instance=default input.limit-process-routes-ipv6=10 local.role=ebgp-provider name=cyberdyne-v6 output.filter-chain=CUSTOMER-OUT-V6 output.network=bgp-networks-v6 remote.address=2001:db8:100:6::4/128 remote.as=65540
/routing ospf instance
add name=ospf-v2 redistribute="connected,static" router-id=198.51.100.1 version=2
/routing ospf area
add area-id=0.0.0.0 instance=ospf-v2 name=ospf-v2-0.0.0.0
/routing ospf interface-template
add passive area=ospf-v2-0.0.0.0 interfaces=loopback
add passive area=ospf-v2-0.0.0.0 interfaces=mgmt
add area=ospf-v2-0.0.0.0 cost=10 interfaces=qsfp28-1-1 type=ptp use-bfd=yes
add area=ospf-v2-0.0.0.0 cost=10 interfaces=infra use-bfd=yes
add area=ospf-v2-0.0.0.0 cost=1000 interfaces=gre-b1 type=ptp
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
set winbox address="10.0.99.0/24,10.1.99.0/24,10.254.2.0/24" disabled=no
set reverse-proxy disabled=yes
/ip ssh
set strong-crypto=yes
/tool mac-server
set allowed-interface-list=native
/tool mac-server mac-winbox
set allowed-interface-list=native
/tool mac-server ping
set enabled=no
/tool bandwidth-server
set enabled=no
/ip neighbor discovery-settings
set discover-interface-list=lldp protocol=lldp
/snmp
set contact=noc@example.net enabled=yes location="Site A, rack 1"
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
set name=edge-a1
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
set enabled=yes interfaces="transit-a,ix" packet-sampling=yes sampling-interval=1000 sampling-space=1
/ip traffic-flow target
add dst-address=10.0.20.40 port=4739 version=ipfix
