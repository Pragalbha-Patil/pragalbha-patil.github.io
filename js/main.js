(function ($) {
  $.fn.inputFilter = function (inputFilter) {
    return this.on("input keydown keyup mousedown mouseup select contextmenu drop", function () {
      if (inputFilter(this.value)) {
        this.oldValue = this.value;
        this.oldSelectionStart = this.selectionStart;
        this.oldSelectionEnd = this.selectionEnd;
      } else if (this.hasOwnProperty("oldValue")) {
        this.value = this.oldValue;
        this.setSelectionRange(this.oldSelectionStart, this.oldSelectionEnd);
      }
    });
  };
}(jQuery));

jQuery(document).ready(function ($) {

  $(window).scroll(function () {
    var height = $(window).height();
    var scroll = $(window).scrollTop();
    if (scroll) {
      $(".header-hide").addClass("scroll-header");
    } else {
      $(".header-hide").removeClass("scroll-header");
    }

  });

  // Back to top button
  $(window).scroll(function () {
    if ($(this).scrollTop() > 100) {
      $('.back-to-top').fadeIn('slow');
    } else {
      $('.back-to-top').fadeOut('slow');
    }
  });
  $('.back-to-top').click(function () {
    $('html, body').animate({
      scrollTop: 0
    }, 1500, 'easeInOutExpo');
    return false;
  });

  // Initiate the wowjs animation library
  new WOW().init();

  // Initiate superfish on nav menu
  $('.nav-menu').superfish({
    animation: {
      opacity: 'show'
    },
    speed: 400
  });

  // Mobile Navigation
  if ($('#nav-menu-container').length) {
    var $mobile_nav = $('#nav-menu-container').clone().prop({
      id: 'mobile-nav'
    });
    $mobile_nav.find('> ul').attr({
      'class': '',
      'id': ''
    });
    $('body').append($mobile_nav);
    $('body').prepend('<button type="button" id="mobile-nav-toggle"><i class="fa fa-bars"></i></button>');
    $('body').append('<div id="mobile-body-overly"></div>');
    $('#mobile-nav').find('.menu-has-children').prepend('<i class="fa fa-chevron-down"></i>');

    $(document).on('click', '.menu-has-children i', function (e) {
      $(this).next().toggleClass('menu-item-active');
      $(this).nextAll('ul').eq(0).slideToggle();
      $(this).toggleClass("fa-chevron-up fa-chevron-down");
    });

    $(document).on('click', '#mobile-nav-toggle', function (e) {
      $('body').toggleClass('mobile-nav-active');
      $('#mobile-nav-toggle i').toggleClass('fa-times fa-bars');
      $('#mobile-body-overly').toggle();
    });

    $(document).click(function (e) {
      var container = $("#mobile-nav, #mobile-nav-toggle");
      if (!container.is(e.target) && container.has(e.target).length === 0) {
        if ($('body').hasClass('mobile-nav-active')) {
          $('body').removeClass('mobile-nav-active');
          $('#mobile-nav-toggle i').toggleClass('fa-times fa-bars');
          $('#mobile-body-overly').fadeOut();
        }
      }
    });
  } else if ($("#mobile-nav, #mobile-nav-toggle").length) {
    $("#mobile-nav, #mobile-nav-toggle").hide();
  }

  // Smooth scroll for the menu and links with .scrollto classes
  $('.nav-menu a, #mobile-nav a, .scrollto').on('click', function () {
    if (location.pathname.replace(/^\//, '') == this.pathname.replace(/^\//, '') && location.hostname == this.hostname) {
      var target = $(this.hash);
      if (target.length) {
        var top_space = 0;

        if ($('#header').length) {
          top_space = $('#header').outerHeight();

          if (!$('#header').hasClass('header-fixed')) {
            top_space = top_space - 20;
          }
        }

        $('html, body').animate({
          scrollTop: target.offset().top - top_space
        }, 1500, 'easeInOutExpo');

        if ($(this).parents('.nav-menu').length) {
          $('.nav-menu .menu-active').removeClass('menu-active');
          $(this).closest('li').addClass('menu-active');
        }

        if ($('body').hasClass('mobile-nav-active')) {
          $('body').removeClass('mobile-nav-active');
          $('#mobile-nav-toggle i').toggleClass('fa-times fa-bars');
          $('#mobile-body-overly').fadeOut();
        }
        return false;
      }
    }
  });

  // Modal video
  new ModalVideo('.js-modal-btn', {
    channel: 'youtube'
  });

  // Init Owl Carousel
  $('.owl-carousel').owlCarousel({
    items: 4,
    autoplay: true,
    loop: true,
    margin: 30,
    dots: true,
    responsiveClass: true,
    responsive: {

      320: {
        items: 1
      },
      480: {
        items: 2
      },
      600: {
        items: 2
      },
      767: {
        items: 3
      },
      768: {
        items: 3
      },
      992: {
        items: 4
      }
    }
  });

  // custom code
  // $("#coin").on("click", function () {
  //   var flipResult = Math.random();
  //   $("#coin").removeClass();
  //   setTimeout(function () {
  //     if (flipResult <= 0.5) {
  //       $("#coin").addClass("heads");
  //       console.log("it is head");
  //     } else {
  //       $("#coin").addClass("tails");
  //       console.log("it is tails");
  //     }
  //   }, 100);
  // });

  function wait(ms){
    var start = new Date().getTime();
    var end = start;
    while(end < start + ms) {
      end = new Date().getTime();
   }
 }

  // Restrict input to digits by using a regular expression filter.
  $("#coin-input").inputFilter(function (value) {
    return /^\d*$/.test(value);
  });

  $('#amount-input').submit(function (e) {
    e.preventDefault();
    // var inputmoney = $("#coin-input").val();
    // alert(inputmoney);
    var hero = document.getElementById('hero');
    hero.parentNode.removeChild(hero);
    var getstarted = document.getElementById('get-started');
    getstarted.parentNode.removeChild(getstarted);
    var video = document.getElementById('video');
    video.parentNode.removeChild(video);
    document.getElementById('coin').style.visibility = "visible";
    document.getElementById('coin-msg').style.visibility = "visible";
    document.getElementById('game-goback').style.visibility = "visible";
    document.getElementById('coin-msg').style.visibility = "visible";
    document.getElementById('lets-play').style.visibility = "hidden";

    var inputvalue = document.getElementById('coin-input').value;
    // alert(inputvalue);
    var startMoney = 2;
    var incMoney = startMoney;
    var win = 0;
    var lose = 0;
    $("#coin").on("click", function () {
      var flipResult = Math.random();
      $("#coin").removeClass();
      setTimeout(function () {
        if (flipResult <= 0.5) {
          $("#coin").addClass("heads");
          console.log("it is FACT");
          incMoney = incMoney * 2;
          $("h4").empty();
          $("h4").append("You're playing for "+incMoney+"$");
          console.log("You're playing for "+incMoney+"$");
          // alert(incMoney);

        } else {
          $("#coin").addClass("tails");
          console.log("it is FALSE");
          $("h4").empty();
          $("h4").append("Keep playing!");
          // alert(inputvalue);
          if( inputvalue > incMoney ) {
            lose = 1;
            $("h4").empty();
            // $("h5").empty();
            $("h4").append("Money you were playing for: "+incMoney+"$");
            $("h5").append("Money you paid: "+inputvalue+"$");
            console.log("Money you were playing for: "+incMoney);
            console.log("Money you paid: "+inputvalue);
            alert("You lose, since you paid "+inputvalue+"$ and lost at "+incMoney+"$");
            document.getElementById('coin').style.visibility = "hidden";
            document.getElementById('coin-msg').style.visibility = "hidden";

            document.getElementById('defeat-msg').style.visibility = "visible";
            document.getElementById('goback').style.visibility = "visible";
          }
          else {
            win = 1;
            alert("You won, since you paid "+inputvalue+"$ and got "+incMoney+"$");
          }
        }
      }, 100);
    }); //amount input
  });
});