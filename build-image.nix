{ pkgs ? import <nixpkgs> {} }:

pkgs.dockerTools.buildLayeredImage {
  name = "lovable-ui";
  tag = "latest";
  contents = [
    pkgs.nodejs_22
    pkgs.cacert
    pkgs.coreutils
    pkgs.bash
  ];
  config = {
    WorkingDir = "/app";
    Env = [
      "NODE_ENV=production"
      "PORT=3000"
      "HOST=0.0.0.0"
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    ExposedPorts = {
      "3000/tcp" = {};
    };
    Cmd = [ "node" "/app/build/index.js" ];
    User = "65534:65534";
  };
}
