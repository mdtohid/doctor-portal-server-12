const express = require('express');
var cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { query } = require('express');
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;
const app = express();

app.use(express.json());
app.use(cors());

const  verifyJwt = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    res.status(401).send({ message: 'User not found' });
  }
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      res.status(403).send({ message: 'Forbidden access' })
    }
    req.decoded = decoded;
    next();
  });
}

async function sendBookingEmail(booking) {
  const { patient, treatment, date, slot } = booking;
  // This is your API key that you retrieve from www.mailgun.com/cp (free up to 10K monthly emails)
  const auth = {
    auth: {
      api_key: process.env.EMAIL_SEND_KEY,
      domain: process.env.EMAIL_SEND_DOMAIN
    }
  }

  const transporter = nodemailer.createTransport(mg(auth));

  transporter.sendMail({
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    'replyTo': 'sagormdtohid@gmail.com',

    text: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed`,

    html: `
    <div>
    <p>${patient}</p>
    <p>${treatment}</p>
    <p>${date}</p>
    <p>${slot}</p>
    </div>
    `

  }, (err, info) => {
    if (err) {
      console.log(`Error: ${err}`);
    }
    else {
      console.log(`Response: ${info}`);
    }
  });
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tpg4ggp.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db("doctor-portal").collection("service");
    const bookingCollection = client.db("doctor-portal").collection("bookings");
    const userCollection = client.db("doctor-portal").collection("user");
    const doctorCollection = client.db("doctor-portal").collection("doctor");
    const paymentCollection = client.db("doctor-portal").collection("payment");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const query = { email: requester };
      const requesterAccount = await userCollection.findOne(query);
      console.log(requesterAccount.email);
      if (requesterAccount?.role === 'admin') {
        next();
      }
      else {
        res.status(403).send({ message: 'Forbidden access' });
      }
    }

    app.get('/service', async (req, res) => {
      const query = {};
      // const cursor = serviceCollection.find(query);
      // how i get a field in all query of a collection in mongodb with node.js
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const result = await cursor.toArray();
      res.send(result);
    })

    // Warning: This is not the proper way to query multiple collection. 
    // After learning more about mongodb. use aggregate, lookup, pipeline, match, group
    app.get('/available', async (req, res) => {
      const date = req.query.date;
      const query = { date: date };
      //get all services
      const services = await serviceCollection.find().toArray();
      //get all booking services that day
      const booking = await bookingCollection.find(query).toArray();
      //rendering services get each service
      services.forEach(service => {
        //identified service
        const bookingService = booking.filter(book => book.treatment === service.name);
        //get identified service slot
        const bookingSlots = bookingService.map(b => b.slot);
        //a array don't exist in other array
        const available = service.slots.filter(slot => !bookingSlots.includes(slot));
        //set service available
        service.slots = available;
        console.log(available);
      })
      res.send(services);
    })


    app.get('/booking', verifyJwt, async (req, res) => {
      const decoded = req.decoded.email;
      const patient = req.query.patient;
      if (decoded === patient) {
        const query = { patient: patient };
        const cursor = bookingCollection.find(query);
        const result = await cursor.toArray();
        // console.log(result);
        res.send(result);
      }
      else {
        res.status(403).send({ message: 'Forbidden access' });
      }
    })


    app.get('/booking/:id', verifyJwt, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    })

    app.patch('/booking/:id', verifyJwt, async (req, res) => {
      const id = req.params?.id;
      const payment = req.body;
      // console.log(payment, id);
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment?.transactionId
        },
      };
      const paymentInsert = await paymentCollection.insertOne(payment);
      const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
      res.send({updatedBooking, paymentInsert});
    })


    app.post('/booking', async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ result: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      sendBookingEmail(booking);
      return res.send({ result: true, result });
    })

    app.get('/user', verifyJwt, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    })

    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email }
      const result = await userCollection.findOne(query);
      const isAdmin = result?.role === 'admin';
      res.send({ admin: isAdmin });
    })

    app.put('/user/admin/:email', verifyJwt, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      // const requester = req.decoded.email;
      // const query = { email: requester };
      // const requesterAccount = await userCollection.findOne(query);
      // console.log(requesterAccount.email);
      // if (requesterAccount?.role === 'admin') {
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: { role: 'admin' }
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      res.send({ result });
      // }
      // else {
      //   res.status(403).send({ message: 'Forbidden access' })
      // }
    })

    app.put('/user/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      console.log(email, user);
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ result, token });
    })

    app.post('/doctor', verifyJwt, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    })

    app.get('/doctor', verifyJwt, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await doctorCollection.find(query).toArray();
      res.send(result);
    })

    app.delete('/doctor/:email', verifyJwt, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await doctorCollection.deleteOne(query);
      res.send(result);
    })

    app.post("/create-payment-intent", async (req, res) => {
      const service = req.body;
      const price = service.price;
      const amount = price * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: [
          "card"
        ],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

  }
  finally {
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello world!');
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})