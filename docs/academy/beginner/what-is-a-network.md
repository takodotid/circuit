---
title: What is a network?
description: A network is two or more devices joined so they can send each other messages. Plug some in, send a message, and see what the internet is made of.
---

# What is a network?

A network is two or more devices joined together so they can send each other messages. That is all. Your phone, your laptop and the printer at home, joined through the box your internet provider gave you, are a network.

Everything else in these lessons is about how those messages find their way.

## Devices and links

A network has two kinds of parts:

- **Devices**: anything that sends or receives messages. A laptop, a phone, a printer, a TV, a camera, a server in a data centre.
- **Links**: whatever carries the messages between them. A cable, or radio waves, which is what Wi-Fi is.

Joining every device to every other device with its own cable would need a lot of cables: ten devices would need forty-five. So devices are joined to one box in the middle instead, and the box passes each message on to the device it is for. At home, that box is your <Term means="The box that joins the devices in your home to each other and to the internet. Your internet provider usually gives you one.">home router</Term>.

<TryIt title="Build a home network">

Plug devices into the home router, then send a message from one to another. Try sending before a device is plugged in, too.

<FirstNetwork />

</TryIt>

What you just saw is the whole idea: a message can only reach a device that has a way through, and the box in the middle is what passes it on.

<Quiz
  question="You send a photo from your phone to the printer at home. Which way does it go?"
  :choices="['Straight from the phone to the printer', 'From the phone to the home router, then to the printer', 'From the phone to the internet, then to the printer']"
  :answer="1"
  :why="['Your phone and printer are not joined to each other directly. Each is joined to the box in the middle.', '', 'A message between two devices in your home stays at home. Only the router passes it on, and the printer is right there.']"
  explain="Each device is joined to the home router, and the router passes the photo on to the printer. It never leaves your home."
/>

## The internet is a network of networks

Your home is one network. Your office is another, and so is your school, your mobile provider, and every company with servers. Each of them is joined to at least one other network, and those to others again.

The internet is all of these networks joined together. Nobody owns all of it. When you open a website, your message leaves your home network through the router, passes through several other networks, and arrives at the network the website lives in.

In the widget above, the cable from the home to the internet is the one that makes this possible. Unplug it, and the devices at home can still talk to each other, but not to the website.

<Quiz
  question="Your internet stops working, but the Wi-Fi at home is still on. Can your laptop still print to the printer at home?"
  :choices="['Yes', 'No']"
  :answer="0"
  :why="['', 'Printing only needs your home network: the laptop, the router and the printer. The link to the internet is not used.']"
  explain="The message from the laptop to the printer stays inside your home network, so it does not need the internet at all."
/>

## Who passes messages on

The box in the middle of a home does several jobs at once. In bigger networks, each job gets a device of its own, and you meet each of them in the coming lessons:

- A **switch** joins the devices in one place, such as the computers on one floor, and passes messages between them.
- A **router** joins one network to another, such as your home to your internet provider.
- An **access point** is how devices without a cable, such as phones, join the network over Wi-Fi.

Circuit, the tool these lessons build up to, writes down how switches and routers like these should be set up, one file per device. To write one down, you first need to know what it does, and that is what the Beginner level is for.

## In short

- A network is devices joined by links so they can send each other messages.
- Devices are joined to a box in the middle, which passes each message on.
- The internet is many networks joined together, and nobody owns all of it.
