<head-bottom>
  <meta name="description" content="Product information and development notes for CS3227-2610-MP4, a secure AI-assisted software engineering project.">
  <link rel="stylesheet" href="{{baseUrl}}stylesheets/main.css">
</head-bottom>

<header sticky>
  <navbar type="dark" class="site-navbar">
    <a slot="brand" href="{{baseUrl}}index.html" title="NoPressure home" class="navbar-brand">NoPressure</a>
    <li><a href="{{baseUrl}}index.html" class="nav-link nav-link-text">Overview</a></li>
    <li><a href="{{baseUrl}}user-guide.html" class="nav-link nav-link-text">User Guide</a></li>
    <li><a href="{{baseUrl}}developer-guide.html" class="nav-link nav-link-text">Developer Guide</a></li>
    <li><a href="{{baseUrl}}reflections.html" class="nav-link nav-link-text">Reflections</a></li>
    <li><a href="{{baseUrl}}releases.html" class="nav-link nav-link-text">Releases</a></li>
    <li><a href="https://github.com/CS3227-2610-MP4-project-x/CS3227-2610-MP4" class="nav-link"><md>:fab-github:</md></a></li>
  </navbar>
</header>

<div id="flex-body">
  <nav id="site-nav">
    <div class="site-nav-top"><div class="fw-bold mb-2">NoPressure</div></div>
    <div class="nav-component slim-scroll">
      <site-nav>
* [Overview]({{baseUrl}}index.html)
* Product
  * [Role workflows]({{baseUrl}}contents/topic1.html)
  * [Security and AI]({{baseUrl}}contents/topic2.html)
  * [Engineering process]({{baseUrl}}contents/topic3a.html)
  * [Project notes]({{baseUrl}}contents/topic3b.html)
* Guides
  * [User Guide]({{baseUrl}}user-guide.html)
  * [Developer Guide]({{baseUrl}}developer-guide.html)
* Reflections
  * [Overview]({{baseUrl}}reflections.html)
  * [Lim-ZY Reflection]({{baseUrl}}Lim-ZY_Reflection.html)
  * [thegrimbee Reflection]({{baseUrl}}thegrimbee_Reflection.html)
* [Releases]({{baseUrl}}releases.html)
      </site-nav>
    </div>
  </nav>
  <div id="content-wrapper">
    {{ content }}
  </div>
  <nav id="page-nav">
    <div class="nav-component slim-scroll">
      <page-nav />
    </div>
  </nav>
  <scroll-top-button></scroll-top-button>
</div>

<footer>
  <div class="footer-inner"><span>CS3227-2610-MP4</span><span>NUS CS3227 MP4 · NoPressure</span></div>
</footer>
