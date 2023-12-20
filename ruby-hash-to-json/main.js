! function() {
    function e(e) {
        clearTimeout(a), a = setTimeout(function() {
            s()
        }, 200)
    }

    function s() {
        u.innerHTML = t(l.value)
    }

    function t(e) {
        var s;
        try {
            s = n(e), s = r(s)
        } catch (t) {
            s = '<span class="error">' + t.message + "</span>"
        }
        return s
    }

    function n(e) {
        return e = e.replace(/([{,]\s*):([^>\s]+)\s*=>/g, '$1"$2"=>'), e = e.replace(/([{,]\s*)([0-9]+\.?[0-9]*)\s*=>/g, '$1"$2"=>'), e = e.replace(/([{,]\s*)(".+?"|[0-9]+\.?[0-9]*)\s*=>\s*:([^,}\s]+\s*)/g, '$1$2=>"$3"'), e = e.replace(/([\[,]\s*):([^,\]\s]+)/g, '$1"$2"'), e = e.replace(/=>nil/g, '=>null'), e = e.replace(/([{,]\s*)(".+?"|[0-9]+\.?[0-9]*)\s*=>/g, "$1$2:"), e = e.replace(/([{,]\s*)'(.+?)'\s*=>/g, '$1"$2":'), e = e.replace(/:\s*'([^,}\s]+\s*)'/g, ': "$1"'), JSON.parse(e)
    }

    function r(e) {
        return "string" != typeof e && (e = JSON.stringify(e, null, "  ")), e = e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), e.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function(e) {
            var s = "number";
            return /^"/.test(e) ? s = /:$/.test(e) ? "key" : "string" : /true|false/.test(e) ? s = "boolean" : /null/.test(e) && (s = "null"), '<span class="' + s + '">' + e + "</span>"
        })
    }
    var a, l = document.querySelector("#input"),
        u = document.querySelector("#result");
    l.addEventListener("input", e, !1), s(), l.select()
}();