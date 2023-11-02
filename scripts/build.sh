#!/bin/bash

dir_build=build
dir_lib=lib
dir_root=$PWD

function package()
{
    dest=$dir_root/$dir_build/$2
    cd $dir_root/$dir_lib/$1 
    tsc --outDir $dest \
        --declarationDir $dest \
        --jsx react-jsx
    cp package.json $dest
}

if [ -d "$dir_build" ]
then rm -rf $dir_build/*
else mkdir $dir_build
fi

package core
package react react
