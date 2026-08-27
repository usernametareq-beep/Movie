require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const session = require('express-session');

const app = express();
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/moviehouse';

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Schemas
const movieSchema = new mongoose.Schema({
  title: { type: String, required: true },
  contentType: { type: String, default: 'movie' }, // 'movie' or 'series'
  category: { type: String, required: true },
  poster: { type: String, default: '' },
  videoLinks: [{ name: String, url: String }],
  episodes: [{ season: Number, episodeNumber: Number, name: String, url: String }],
  isPinned: { type: Boolean, default: false },
  views: { type: Number, default: 0 }
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }
});

const Movie = mongoose.model('Movie', movieSchema);
const Category = mongoose.model('Category', categorySchema);

// App Config & Middlewares
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'secretkey123',
  resave: false,
  saveUninitialized: true
}));

// Multer Storage Configuration
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
  })
});

// Admin Middleware
const isAdmin = (req, res, next) => {
  if (req.session.isAdmin) return next();
  res.redirect('/login');
};

// PUBLIC ROUTES

// Home Route with Pagination & Category Filter
app.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const selectedCategory = req.query.category || 'All';

    let filter = {};
    if (selectedCategory !== 'All') filter.category = selectedCategory;

    const totalMovies = await Movie.countDocuments(filter);
    const movies = await Movie.find(filter)
      .sort({ isPinned: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const popularMovies = await Movie.find().sort({ views: -1 }).limit(5);
    const categories = await Category.find().distinct('name');

    res.render('index', {
      movies,
      popularMovies,
      categories,
      selectedCategory,
      currentPage: page,
      totalPages: Math.ceil(totalMovies / limit)
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// Search Route
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const movies = await Movie.find({ title: new RegExp(query, 'i') }).sort({ createdAt: -1 });
    res.render('search', { movies, query });
  } catch (err) {
    res.redirect('/');
  }
});

// Single Movie/Series Details Route
app.get('/movie/:id', async (req, res) => {
  try {
    const movie = await Movie.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    if (!movie) return res.redirect('/');
    
    const relatedMovies = await Movie.find({ category: movie.category, _id: { $ne: movie._id } }).limit(6);
    res.render('movie', { movie, relatedMovies });
  } catch (err) {
    res.redirect('/');
  }
});

// ADMIN ROUTES

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (req.body.password === adminPassword) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('login', { error: 'Invalid Passcode' });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/admin', isAdmin, async (req, res) => {
  try {
    const movies = await Movie.find().sort({ createdAt: -1 });
    const categories = await Category.find().distinct('name');
    const movieToEdit = req.query.edit ? await Movie.findById(req.query.edit) : null;
    
    res.render('admin', { 
      movies, 
      categories, 
      movieToEdit, 
      msg: req.query.msg || null, 
      err: req.query.err || null 
    });
  } catch (err) {
    res.status(500).send('Admin Panel Error');
  }
});

// Save / Update Content (Movies & Series)
app.post('/admin/save', isAdmin, upload.single('posterFile'), async (req, res) => {
  try {
    const { id, contentType, title, category, posterUrl, isPinned, linkName, linkUrl, epSeason, epNum, epName, epUrl } = req.body;
    let poster = req.file ? '/uploads/' + req.file.filename : (posterUrl || '');

    let videoLinks = [];
    let episodes = [];

    if (contentType === 'movie' && linkName) {
      const names = [].concat(linkName);
      const urls = [].concat(linkUrl);
      videoLinks = names.map((name, i) => ({ name, url: urls[i] })).filter(item => item.name && item.url);
    }

    if (contentType === 'series' && epName) {
      const seasons = [].concat(epSeason);
      const nums = [].concat(epNum);
      const names = [].concat(epName);
      const urls = [].concat(epUrl);
      episodes = names.map((name, i) => ({
        season: Number(seasons[i]),
        episodeNumber: Number(nums[i]),
        name,
        url: urls[i]
      })).filter(item => item.url);
    }

    const payload = { 
      title, 
      contentType, 
      category, 
      isPinned: isPinned === 'on', 
      videoLinks, 
      episodes 
    };
    if (poster) payload.poster = poster;

    if (id) {
      await Movie.findByIdAndUpdate(id, payload);
    } else {
      await Movie.create(payload);
    }

    res.redirect('/admin?msg=Content Saved Successfully');
  } catch (err) {
    res.redirect('/admin?err=Failed to Save Content');
  }
});

app.post('/admin/delete/:id', isAdmin, async (req, res) => {
  try {
    await Movie.findByIdAndDelete(req.params.id);
    res.redirect('/admin?msg=Content Deleted');
  } catch (err) {
    res.redirect('/admin?err=Delete Failed');
  }
});

app.post('/admin/toggle-pin/:id', isAdmin, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (movie) {
      movie.isPinned = !movie.isPinned;
      await movie.save();
    }
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin');
  }
});

app.post('/admin/add-category', isAdmin, async (req, res) => {
  try {
    if (req.body.categoryName) {
      await Category.create({ name: req.body.categoryName.trim() });
    }
    res.redirect('/admin?msg=Category Added');
  } catch (err) {
    res.redirect('/admin?err=Category Exists or Invalid');
  }
});

app.post('/admin/delete-category', isAdmin, async (req, res) => {
  try {
    await Category.findOneAndDelete({ name: req.body.categoryName });
    res.redirect('/admin?msg=Category Removed');
  } catch (err) {
    res.redirect('/admin?err=Failed to Remove Category');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
