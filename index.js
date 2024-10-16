const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const prot = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


// middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.712mjau.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const userCollection = client.db("bistroDB").collection("users");
        const menuCollection = client.db("bistroDB").collection("menu");
        const reviewsCollection = client.db("bistroDB").collection("reviews");
        const cartCollection = client.db("bistroDB").collection("carts");
        const paymentCollection = client.db("bistroDB").collection("payments");

        // JWT token related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });

        // verify token middlewares
        const verifyToken = (req, res, next) => {
            // console.log('inside the verify token middlewares', req.headers.authorization);

            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }
                req.decoded = decoded;
                next();
            })
        }

        // use vefify admin after verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin'
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // Users Collection for admin
        app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        // admin check to email
        app.get("/users/admin/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { email: email }
            const user = await userCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin })
        })

        // User collection and client to post (google sign user data save 1 time in database)
        app.post("/users", async (req, res) => {
            const user = req.body;
            // Insert email if user dosen't exist:
            // This system follow many ways (1. email unique, 2. upsert, 3. simple checking(aita use korbo))
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "User Already Exist", insertedId: null });
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        // admin role check & make admin
        app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

        // User delete from admin 
        app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })

        //  Menu collection
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        });

        // specefic menu item get for update item for admin
        app.get("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.findOne(query);
            res.send(result);
        });

        // menu post from admin
        app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
            const menuItem = req.body;
            const result = await menuCollection.insertOne(menuItem);
            res.send(result);
        });

        //specefic menu item update from admin
        app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    name: item.name,
                    category: item.category,
                    price: item.price,
                    recipe: item.recipe,
                    image: item.image
                }
            }
            const result = await menuCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // menu delete from admin
        app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })

        // Reviews collection
        app.get("/reviews", async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        });

        // cart collection for all user
        app.get("/carts", async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        // client to carts post for public user
        app.post("/carts", async (req, res) => {
            const cartsItem = req.body;
            const result = await cartCollection.insertOne(cartsItem);
            res.send(result);
        });

        // delete cart for public user
        app.delete("/carts/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });


        // Payment related api
        // Payment intent
        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            console.log('amount inside the intent', amount);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret
            });
        });

        app.get('/payments/:email',verifyToken, async (req, res) => {
            const query = { email: req.params.email }
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        })

        // Payment data saved database and delete all cart item
        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentRes = await paymentCollection.insertOne(payment);

            // carefully delete each item from the cart

            const query = {
                _id: {
                    $in: payment.cartItemIds.map(id => new ObjectId(id))
                }
            }
            const deleteResult = await cartCollection.deleteMany(query);
            console.log('Payment info', payment, query, deleteResult);
            res.send({ paymentRes, deleteResult });
        });

        // Stats or analytics(Admin Home)
        app.get('/admin-stats',verifyToken,verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            // this is not the best way for revenue count
            // const payments = await paymentCollection.find().toArray();
            // const revenue = payments.reduce((total, payment) => total + payment.price, 0);

            // best way for revenue count
            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: "$price"
                        }
                    }
                }
            ]).toArray();

            const revenue = result.length > 0 ? result[0].totalRevenue : 0;

            res.send({
                users,
                menuItems,
                orders,
                revenue
            })
        });

        /**
         * -----------------------
         * Non-Efficient way
         * -----------------------
         * 1. Load all the payments.
         * 2. For every menuItemIds (which is an array), go find the item from menu collection.
         * 3. For every item in the menu collection that you found from a payment entry (document);
         * */
        
        // Using aggregate pipeline
        app.get('/order-stats', async (req, res) => {
            const result = await paymentCollection.aggregate([
                {
                    $unwind: "$menuItemIds" //Unwind the array of menu item ids
                },
                {
                    $lookup: {
                        from: "menu", // The 'menu' collection
                        localField: "menuItemIds", // Field in the 'payments' collection
                        foreignField: "_id", // Matching field in the 'menu' collection
                        as: "menuItems" //The result will be stored in this field
                    }
                },
                {
                    $unwind: "$menuItems" // Unwind the joined menu items array
                },
                {
                    $group: {
                        _id: "$menuItems.category", //Group by category
                        totalQuantity: { $sum: 1 }, //Count the number of items ordered per category
                        totalRevenue: {$sum: "$menuItems.price"} // Calculate the total revenue per category
                    }
                }

            ]).toArray();

            res.send(result);
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('This is bistro restaurent sitting');
});

app.listen(prot, () => {
    console.log(`Bistro boss port running is ${prot}`);

});