---
title: What is a network?
description: A network is two or more devices joined so they can send each other messages. Plug some in, send a message, and see what the internet is made of.
---

# What is a network?

A network is two or more devices joined so they can send each other messages. Your phone, your laptop, and the printer at home are a network. The box from your internet provider joins them.

## Devices and links

A network has two kinds of parts:

- **Devices** send and receive messages: a laptop, a phone, a printer, a TV, a camera, or a server in a data center.
- **Links** carry the messages between devices. A link is a cable or radio waves. Wi-Fi uses radio waves.

To join each of ten devices to every other one, you would need 45 cables. So each device is joined to one box in the middle instead. The box passes each message on to the device it is for. At home, that box is your <Term means="The box that joins the devices in your home to each other and to the internet. Your internet provider usually gives you one.">home router</Term>.

<TryIt title="Build a home network">

<FirstNetwork />

</TryIt>

<Quiz
  question="You send a photo from your phone to the printer at home. Which way does it go?"
  :choices="['Straight from the phone to the printer', 'From the phone to the home router, then to the printer', 'From the phone to the internet, then to the printer']"
  :answer="1"
  :why="['Your phone and your printer are not joined to each other. Each one is joined to the box in the middle.', '', 'A message between two devices in your home stays at home. The home router passes it straight to the printer.']"
  explain="Each device is joined to the home router, and the router passes the photo on to the printer. The photo never leaves your home."
/>

## The internet is a network of networks

Your home is one network. Your office is another, and so are your school and your mobile provider. Each of these networks is joined to at least one other network.

The internet is all of these networks joined together. Nobody owns all of it. When you open a website, your message leaves your home through the home router. It crosses several other networks and arrives at the website's network.

<Quiz
  question="Your internet stops working, but the Wi-Fi at home is still on. Can your laptop still print to the printer at home?"
  :choices="['Yes', 'No']"
  :answer="0"
  :why="['', 'Printing only needs your home network: the laptop, the home router, and the printer. The link to the internet is not used.']"
  explain="The message from the laptop to the printer stays inside your home network, so it does not need the internet."
/>

## One box, many jobs

The box in the middle of a home is called a router, but it is really several devices in one case.

<TryIt title="Open up the home router">

<HomeRouterParts />

</TryIt>

At home, one box is enough. It has a few devices, one line to the internet, and nobody to look after it. An office has more devices than four sockets can hold, and more rooms than one Wi-Fi radio can reach. So each job gets a box of its own. Each box can be bigger, doubled in case one fails, or replaced on its own.

- A **switch** joins the devices in one place, such as the computers on one floor. It passes messages between them. The sockets on the back of a home router are a small switch.
- A **router** joins one network to another, such as your home to your internet provider.
- An **access point** joins devices without a cable, such as phones, over Wi-Fi.

When a lesson says "the switch" or "the router", think of that part of your home router.

<Quiz
  question="You plug a desktop computer into one of the four sockets on the back of your home router. Which part of the box joins it to the rest of your home network?"
  :choices="['The router', 'The switch', 'The Wi-Fi access point']"
  :answer="1"
  :why="['The router joins your home to the internet. Between two devices at home, the switch does the work.', '', 'The access point is for devices without a cable. The desktop has a cable.']"
  explain="The sockets on the back are a small switch built into the box. It joins every device with a cable to the others."
/>
